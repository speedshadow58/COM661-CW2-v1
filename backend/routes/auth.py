from flask import Blueprint, request
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime, timedelta
import jwt
from config import db, JWT_SECRET_KEY
from utils import api_response, require_admin 

auth_bp = Blueprint('auth_bp', __name__, url_prefix="/api/v1.0/auth")

users_col = db.users

# ============================================================
# REGISTER USER
# ============================================================
@auth_bp.route("/register", methods=["POST"])
def register_user():
    required_fields = ["username", "password"]
    if not all(field in request.form for field in required_fields):
        return api_response({"error": "Missing registration data"}, status=400)

    username = request.form["username"].strip().lower()
    password = request.form["password"]
    role = request.form.get("role", "user").lower()  # default = user

    if users_col.find_one({"$or": [{"username": username} ]}):
        return api_response({"error": "Username already exists"}, status=400)

    hashed_pw = generate_password_hash(password)
    user = {
        "username": username,
        "password": hashed_pw,
        "role": role,
        "created_at": datetime.utcnow()
    }

    result = users_col.insert_one(user)
    print(f"[DEBUG] Inserted user: {user} with _id: {result.inserted_id}")
    return api_response({
        "message": f"User '{username}' registered successfully",
        "role": role
    }, status=201)


# ============================================================
# LOGIN USER (returns JWT)
# ============================================================
@auth_bp.route("/login", methods=["POST"])
def login_user():
    required_fields = ["username", "password"]
    if not all(field in request.form for field in required_fields):
        return api_response({"error": "Missing login data"}, status=400)

    username = request.form["username"].strip().lower()
    password = request.form["password"]

    user = users_col.find_one({"username": username})
    if not user or not check_password_hash(user["password"], password):
        return api_response({"error": "Invalid username or password"}, status=401)

    payload = {
        "user_id": str(user["_id"]),
        "username": user["username"],
        "role": user.get("role", "user"),
        "exp": datetime.utcnow() + timedelta(hours=1),
        "iat": datetime.utcnow()
    }
    token = jwt.encode(payload, JWT_SECRET_KEY, algorithm="HS256")

    return api_response({
        "message": "Login successful",
        "token": token,
        "role": user.get("role", "user")
    }, status=200)


# ============================================================
# ADMIN TEST ENDPOINT (optional)
# ============================================================
@auth_bp.route("/admin-test", methods=["GET"])
@require_admin
def admin_test():
    """Simple endpoint to confirm admin privileges work."""
    return api_response({"message": "Admin access confirmed!"}, status=200)


# ============================================================
# TOKEN VALIDATION & USER INFO
# ============================================================
@auth_bp.route("/validate", methods=["GET"])
def validate_token():
    """
    Validate JWT token and return user info.
    Moves token decoding logic from frontend to backend.
    """
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        return api_response({"error": "No token provided"}, status=401)
    
    token = auth_header.split(" ")[1]
    
    try:
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=["HS256"])
        return api_response({
            "valid": True,
            "username": payload.get("username"),
            "role": payload.get("role"),
            "user_id": payload.get("user_id"),
            "expires_at": payload.get("exp")
        }, status=200)
    except jwt.ExpiredSignatureError:
        return api_response({"error": "Token has expired", "valid": False}, status=401)
    except jwt.InvalidTokenError:
        return api_response({"error": "Invalid token", "valid": False}, status=401)


@auth_bp.route("/me", methods=["GET"])
def get_current_user():
    """
    Get current user info from token.
    Requires valid JWT token in Authorization header.
    """
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        return api_response({"error": "No token provided"}, status=401)
    
    token = auth_header.split(" ")[1]
    
    try:
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=["HS256"])
        user = users_col.find_one({"username": payload.get("username")}, {"_id": 0, "password": 0})
        if not user:
            return api_response({"error": "User not found"}, status=404)
        
        return api_response({
            "username": user.get("username"),
            "role": user.get("role"),
            "created_at": user.get("created_at")
        }, status=200)
    except jwt.ExpiredSignatureError:
        return api_response({"error": "Token has expired"}, status=401)
    except jwt.InvalidTokenError:
        return api_response({"error": "Invalid token"}, status=401)

