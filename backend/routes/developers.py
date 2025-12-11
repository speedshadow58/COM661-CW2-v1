from flask import Blueprint, request
import json
from config import db
from utils import (
    clean_doc,
    get_pagination_params,
    api_response,
    require_admin,
    log_action
)

games_collection = db.steamGames
developers_bp = Blueprint('developers_bp', __name__)

# ============================================================
# DEVELOPERS ROUTES (steamGames unified, flat schema)
# ============================================================

# ---------- GET ALL DEVELOPERS ----------
@developers_bp.route("/api/v1.0/games/developers", methods=['GET'])
def get_developers():
    """Aggregate all unique developer names and their associated games, skipping malformed docs."""
    import re
    pipeline = [
        {"$match": {"metadata.developers": {"$type": "array", "$ne": []}}},
        {"$unwind": "$metadata.developers"},
        {"$match": {"metadata.developers": {"$type": "string", "$ne": None, "$ne": ""}}},
        {"$group": {
            "_id": "$metadata.developers",
            "games": {"$addToSet": {"appid": "$appid", "name": "$name"}}
        }},
        {"$sort": {"_id": 1}}
    ]
    results = list(games_collection.aggregate(pipeline))
    # Filter out developer names that look like stringified lists or are malformed
    valid_developers = []
    for r in results:
        dev = r["_id"]
        # Exclude if it looks like a list or contains brackets/quotes/comma-separated values
        if not dev or not isinstance(dev, str):
            continue
        if re.search(r"[\[\]\(\)\{\}'\"].*[,\]]", dev):
            continue
        valid_developers.append({"developer": dev.strip(), "games": r["games"]})
    return api_response(valid_developers)


# ---------- GET DEVELOPERS FOR A SINGLE GAME ----------
@developers_bp.route("/api/v1.0/games/<int:appid>/developers", methods=['GET'])
def get_developer(appid):
    """Return developer and publisher info for a single game."""
    game = clean_doc(games_collection.find_one({'appid': appid}, {"_id": 0}))
    if not game:
        return api_response({"error": "Game not found"}, status=404)

    developer_info = {
        "appid": appid,
        "name": game.get("name"),
        "developers": game.get("metadata", {}).get("developers", []),
        "publishers": game.get("metadata", {}).get("publishers", []),
        "support_url": game.get("media", {}).get("support_url", ""),
        "website": game.get("media", {}).get("website", "")
    }
    return api_response(developer_info)


# ---------- RENAME DEVELOPER (ADMIN ONLY) ----------
@developers_bp.route("/api/v1.0/games/developers/rename", methods=['POST'])
@require_admin
def rename_developer():
    """Rename a developer across all games."""
    data = request.get_json(force=True)
    old_name = data.get('old_name')
    new_name = data.get('new_name')
    if not old_name or not new_name:
        return api_response({"error": "Both old_name and new_name are required."}, status=400)
    result = games_collection.update_many(
        {"metadata.developers": old_name},
        {"$set": {"metadata.developers.$[elem]": new_name}},
        array_filters=[{"elem": old_name}]
    )
    log_action(request.user, "rename", "developer", old_name, {"new_name": new_name, "count": result.modified_count})
    return api_response({"message": f"Renamed {old_name} to {new_name} in {result.modified_count} games."})


# ---------- DELETE DEVELOPER (ADMIN ONLY) ----------
@developers_bp.route("/api/v1.0/games/developers/delete", methods=['POST'])
@require_admin
def delete_developer():
    """Delete a developer from all games."""
    data = request.get_json(force=True)
    name = data.get('name')
    if not name:
        return api_response({"error": "Developer name is required."}, status=400)
    result = games_collection.update_many(
        {"metadata.developers": name},
        {"$pull": {"metadata.developers": name}}
    )
    log_action(request.user, "delete", "developer", name, {"count": result.modified_count})
    return api_response({"message": f"Deleted {name} from {result.modified_count} games."})