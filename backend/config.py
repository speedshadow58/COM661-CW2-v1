from pymongo import MongoClient
import os

# ============================================================
# DATABASE CONFIGURATION
# ============================================================

# Use environment variables for security, with safe local fallbacks
MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017/")
DB_NAME = os.getenv("DB_NAME", "steamDB")

# Initialize MongoDB connection
client = MongoClient(MONGO_URI)
db = client[DB_NAME]

# ============================================================
# JWT CONFIGURATION
# ============================================================

# Secret key for JWT signing
JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "supersecretkey")

# Expiration time (in hours)
JWT_EXP_HOURS = int(os.getenv("JWT_EXP_HOURS", 1))

# ============================================================
# APP DEBUG / ENVIRONMENT SETTINGS
# ============================================================

DEBUG = os.getenv("FLASK_DEBUG", "True").lower() == "true"

# ============================================================
# INFO / DEBUG LOGGING
# ============================================================

def show_config_summary():
    """Print configuration summary (safe for development)."""
    print("CONFIGURATION SUMMARY")
    print(f"Mongo URI: {MONGO_URI}")
    print(f"Database: {DB_NAME}")
    print(f"JWT Expiration: {JWT_EXP_HOURS} hour(s)")
    print(f"Debug Mode: {DEBUG}")
    print("=====================================\n")
