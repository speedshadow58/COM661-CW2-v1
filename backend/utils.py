def fetch_supported_languages(appid):
    """
    Fetch supported languages from Steam API for a given appid.
    Returns a list of language strings or an empty list if unavailable.
    """
    try:
        url = f"https://store.steampowered.com/api/appdetails?appids={appid}&l=english"
        response = requests.get(url, timeout=3)
        if response.status_code == 200:
            data = response.json()
            if str(appid) in data and data[str(appid)].get('success'):
                game_data = data[str(appid)].get('data', {})
                languages_str = game_data.get('supported_languages', '')
                # Remove all HTML tags
                import re
                languages_str = re.sub(r'<[^>]+>', '', languages_str)
                langs = [lang.strip() for lang in languages_str.split(',') if lang.strip()]
                return langs
    except Exception:
        pass
    return []

def enrich_with_supported_languages(game_data):
    """
    Enrich a single game object with supported_languages from Steam API if missing.
    Adds/updates 'supported_languages' in game_data['metadata'].
    """
    if isinstance(game_data, dict) and 'appid' in game_data:
        appid = game_data['appid']
        meta = game_data.get('metadata', {})
        if not meta.get('supported_languages'):
            langs = fetch_supported_languages(appid)
            if langs:
                if 'metadata' not in game_data:
                    game_data['metadata'] = {}
                game_data['metadata']['supported_languages'] = langs
    return game_data

def enrich_games_with_supported_languages(games_list):
    """
    Enrich a list of game objects with supported_languages from Steam API if missing.
    """
    for game in games_list:
        enrich_with_supported_languages(game)
    return games_list
from flask import jsonify, make_response, request
from bson import json_util
from functools import wraps
import json
import jwt
import ast
import requests
from datetime import datetime
from config import JWT_SECRET_KEY, db

# ============================================================
# GENERAL UTILITIES
# ============================================================

def ensure_array(value):
    """
    Normalize a field to always be a list.
    Handles None, str, list, and stringified lists like "['Valve']".
    """
    if value is None:
        return []
    if isinstance(value, list):
        cleaned = []
        for item in value:
            if isinstance(item, str):
                # Try to parse stringified list
                try:
                    parsed = ast.literal_eval(item)
                    if isinstance(parsed, list):
                        cleaned.extend([str(x) for x in parsed])
                    else:
                        cleaned.append(str(parsed))
                except Exception:
                    cleaned.append(item.strip("[]'\""))
            else:
                cleaned.append(item)
        return cleaned
    if isinstance(value, str):
        try:
            parsed = ast.literal_eval(value)
            if isinstance(parsed, list):
                return [str(x) for x in parsed]
            return [str(parsed)]
        except Exception:
            return [value.strip("[]'\"")]
    return [value]

def to_csv_string(value):
    """
    Normalize arrays, dicts, or strings into a clean CSV string.
    """
    if isinstance(value, list):
        return ", ".join([str(v).strip() for v in value if v])
    elif isinstance(value, dict):
        # For tags: just take the keys
        return ", ".join([str(k).strip() for k in value.keys()])
    elif isinstance(value, str):
        return value.strip()
    return ""

def normalize_fields(doc):
    """
    Normalize fields in metadata.
    - Developers, publishers, genres: always lists
    - Tags, supported_languages: CSV strings
    """
    if not doc:
        return doc

    metadata = doc.get("metadata", {})

    for field in ["developers", "publishers", "genres"]:
        if field in metadata:
            metadata[field] = ensure_array(metadata[field])

    for field in ["tags", "supported_languages"]:
        if field in metadata:
            metadata[field] = to_csv_string(metadata[field])

    doc["metadata"] = metadata
    return doc

def normalize_metadata(metadata: dict, as_array: bool = False):
    """
    Normalize metadata fields. If as_array=True, return arrays.
    Otherwise return CSV strings.
    """
    def to_csv_string(values):
        if not values:
            return ""
        if isinstance(values, list):
            return ", ".join(values)
        return str(values)

    if not metadata:
        return {}

    return {
        "developers": metadata.get("developers") if as_array else to_csv_string(metadata.get("developers")),
        "publishers": metadata.get("publishers") if as_array else to_csv_string(metadata.get("publishers")),
        "genres": metadata.get("genres") if as_array else to_csv_string(metadata.get("genres")),
        "tags": metadata.get("tags") if as_array else to_csv_string(metadata.get("tags")),
        "supported_languages": metadata.get("supported_languages") if as_array else to_csv_string(metadata.get("supported_languages")),
        "release_date": metadata.get("release_date"),
        "price": metadata.get("price"),
    }

def clean_doc(doc):
    """Convert a MongoDB document into a clean, JSON-safe dict (without _id)."""
    if not doc:
        return None
    doc = json.loads(json_util.dumps(doc))
    doc.pop("_id", None)
    doc = normalize_fields(doc)
    return doc

def clean_docs(cursor):
    """Convert a MongoDB cursor into a clean list of JSON-safe dicts."""
    docs = json.loads(json_util.dumps(list(cursor)))
    for doc in docs:
        doc.pop("_id", None)
        doc = normalize_fields(doc)
    return docs

# ============================================================
# PAGINATION
# ============================================================

def get_pagination_params():
    """Extract pagination params from request query args."""
    page_num = max(int(request.args.get("pn", 1)), 1)
    page_size = max(int(request.args.get("ps", 10)), 1)
    page_start = page_size * (page_num - 1)
    return page_num, page_size, page_start

# ============================================================
# STANDARD API RESPONSE
# ============================================================

def api_response(data, page_num=None, page_size=None, total_count=None, status=200):
    """Return consistent API JSON responses with pagination links."""
    response_body = {"data": data}
    if page_num and page_size and total_count is not None:
        total_pages = (total_count + page_size - 1) // page_size  # Ceiling division
        
        # Build pagination object
        pagination = {
            "page": page_num,
            "page_size": page_size,
            "total_results": total_count,
            "total_pages": total_pages,
        }
        
        # Build navigation links (HATEOAS)
        base_url = request.base_url
        query_params = dict(request.args)
        
        links = {}
        
        # First page
        query_params['pn'] = 1
        links['first'] = f"{base_url}?{'&'.join(f'{k}={v}' for k, v in query_params.items())}"
        
        # Last page
        query_params['pn'] = total_pages
        links['last'] = f"{base_url}?{'&'.join(f'{k}={v}' for k, v in query_params.items())}"
        
        # Previous page
        if page_num > 1:
            query_params['pn'] = page_num - 1
            links['prev'] = f"{base_url}?{'&'.join(f'{k}={v}' for k, v in query_params.items())}"
        
        # Next page
        if page_num < total_pages:
            query_params['pn'] = page_num + 1
            links['next'] = f"{base_url}?{'&'.join(f'{k}={v}' for k, v in query_params.items())}"
        
        pagination['links'] = links
        response_body["pagination"] = pagination
    return make_response(jsonify(response_body), status)

# ============================================================
# STEAM API INTEGRATION
# ============================================================

def fetch_steam_price(appid):
    """
    Fetch accurate price from Steam API for a given appid.
    Returns the formatted price string (e.g., '£4.29') or None if unavailable.
    """
    try:
        url = f"https://store.steampowered.com/api/appdetails?appids={appid}&cc=gb&filters=price_overview"
        response = requests.get(url, timeout=3)
        if response.status_code == 200:
            data = response.json()
            if str(appid) in data and data[str(appid)].get('success'):
                price_overview = data[str(appid)].get('data', {}).get('price_overview')
                if price_overview:
                    return price_overview.get('final_formatted')
    except Exception:
        pass
    return None

def enrich_with_steam_price(game_data):
    """
    Enrich a single game object with Steam API price.
    Adds 'steam_price' field to the game data.
    """
    if isinstance(game_data, dict) and 'appid' in game_data:
        appid = game_data['appid']
        steam_price = fetch_steam_price(appid)
        game_data['steam_price'] = steam_price
    return game_data

def enrich_games_with_steam_prices(games_list):
    """
    Enrich a list of game objects with Steam API prices.
    Adds 'steam_price' field to each game.
    """
    for game in games_list:
        if isinstance(game, dict) and 'appid' in game:
            appid = game['appid']
            steam_price = fetch_steam_price(appid)
            game['steam_price'] = steam_price
    return games_list

# ============================================================
# JWT AUTH HELPERS
# ============================================================

def decode_token():
    """Decode JWT token from Authorization header and return decoded payload."""
    auth_header = request.headers.get("Authorization", None)
    if not auth_header or not auth_header.startswith("Bearer "):
        return None, api_response({"error": "Missing or invalid token"}, status=401)

    token = auth_header.split(" ")[1]
    try:
        decoded = jwt.decode(token, JWT_SECRET_KEY, algorithms=["HS256"])
        return decoded, None
    except jwt.ExpiredSignatureError:
        return None, api_response({"error": "Token has expired"}, status=401)
    except jwt.InvalidTokenError:
        return None, api_response({"error": "Invalid token"}, status=401)

# ============================================================
# AUTH DECORATORS
# ============================================================

def require_auth(f):
    """Require a valid JWT for user-level access."""
    @wraps(f)
    def wrapper(*args, **kwargs):
        decoded, error = decode_token()
        if error:
            return error
        request.user = decoded
        return f(*args, **kwargs)
    return wrapper

def require_admin(f):
    """Require valid JWT and admin role."""
    @wraps(f)
    def wrapper(*args, **kwargs):
        decoded, error = decode_token()
        if error:
            return error
        if decoded.get("role") != "admin":
            return api_response({"error": "Admin access required"}, status=403)
        request.user = decoded
        return f(*args, **kwargs)
    return wrapper

# ============================================================
# ACTION LOGGING (AUDIT TRAIL)
# ============================================================

def log_action(user, action_type, collection, target_id, details=None, status=None):
    """
    Log CRUD and auth actions for audit purposes.
    - user: decoded JWT payload
    - action_type: CREATE, UPDATE, DELETE, LOGIN, etc.
    - collection: the resource affected (e.g., 'games', 'reviews')
    - target_id: the item's _id or identifier
    - details: optional dict of changes or metadata
    """

    # Use unified action log collection
    logs_col = db.action_logs

    # Ensure details is always a string for frontend display
    if details is not None and not isinstance(details, str):
        try:
            details = json.dumps(details, default=str)
        except Exception:
            details = str(details)
    log_entry = {
        "user_id": user.get("user_id"),
        "username": user.get("username", "unknown"),
        "role": user.get("role", "user"),
        "action": action_type.upper(),
        "collection": collection,
        "target_id": str(target_id),
        "timestamp": datetime.utcnow(),
        "ip": request.remote_addr,
        "details": details or "",
        "endpoint": getattr(request, "path", None),
        "status": status
    }

    try:
        logs_col.insert_one(log_entry)
    except Exception as e:
        print(f"[LOGGING ERROR] Failed to log action: {e}")