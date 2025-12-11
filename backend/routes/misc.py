from flask import Blueprint, request
import json
from datetime import datetime, timedelta
from config import db
from utils import (
    clean_doc,
    get_pagination_params,
    api_response,
    require_admin,
    log_action
)

games_collection = db.steamGames
misc_bp = Blueprint('misc_bp', __name__)

# ============================================================
# MISC ROUTES (steamGames unified)
# ============================================================

# ---------- GET ALL MISC ENTRIES ----------
@misc_bp.route("/api/v1.0/games/misc", methods=['GET'])
def get_misc():
    """Public: Get all misc entries with pagination."""
    page_num, page_size, page_start = get_pagination_params()

    cursor = games_collection.find(
        {},
        {
            "_id": 0,
            "appid": 1,
            "name": 1,
            "metadata.genres": 1,
            "metadata.tags": 1,
            "metadata.supported_languages": 1,
            "metadata.developers": 1,
            "metadata.publishers": 1,
            "playtime.peak_ccu": 1,
            "created_at": 1
        }
    ).sort("created_at", -1).skip(page_start).limit(page_size)

    data_to_return = []
    import ast
    for doc in cursor:
        # Parse tags if they are stringified dicts
        tags_raw = doc.get("metadata", {}).get("tags", [])
        tags = []
        if tags_raw and isinstance(tags_raw, list) and len(tags_raw) > 0:
            first = tags_raw[0]
            if isinstance(first, str):
                try:
                    tag_dict = ast.literal_eval(first)
                    if isinstance(tag_dict, dict):
                        tags = list(tag_dict.keys())
                    else:
                        tags = tags_raw
                except Exception:
                    tags = tags_raw
            else:
                tags = tags_raw
        structured = {
            "appid": doc.get("appid"),
            "name": doc.get("name"),
            "details": {
                "genres": doc.get("metadata", {}).get("genres", []),
                "tags": tags,
                "supported_languages": doc.get("metadata", {}).get("supported_languages", [])
            },
            "stats": {"peak_ccu": doc.get("playtime", {}).get("peak_ccu", 0)},
            "companies": {
                "developers": doc.get("metadata", {}).get("developers", []),
                "publishers": doc.get("metadata", {}).get("publishers", [])
            }
        }
        data_to_return.append(structured)
    # Debug log
    print(f"[MISC ANALYTICS] Returning {len(data_to_return)} games. First: {data_to_return[0] if data_to_return else 'None'}")

    total_count = games_collection.count_documents({})
    return api_response(data_to_return, page_num, page_size, total_count)


# ---------- GET SINGLE MISC ENTRY ----------
@misc_bp.route("/api/v1.0/games/misc/<int:appid>", methods=['GET'])
def get_misc_entry(appid):
    """Public: Get details for a single misc entry."""
    doc = clean_doc(games_collection.find_one({'appid': appid}, {"_id": 0}))
    if not doc:
        return api_response({"error": "Misc entry not found"}, status=404)

    structured = {
        "appid": doc.get("appid"),
        "name": doc.get("name"),
        "details": {
            "genres": doc.get("metadata", {}).get("genres", []),
            "tags": doc.get("metadata", {}).get("tags", []),
            "supported_languages": doc.get("metadata", {}).get("supported_languages", [])
        },
        "stats": {"peak_ccu": doc.get("playtime", {}).get("peak_ccu", 0)},
        "companies": {
            "developers": doc.get("metadata", {}).get("developers", []),
            "publishers": doc.get("metadata", {}).get("publishers", [])
        }
    }
    return api_response(structured)


# ---------- ADD NEW MISC ENTRY ----------
@misc_bp.route("/api/v1.0/games/misc", methods=['POST'])
@require_admin
def post_misc():
    """Admin: Add or update misc info for a game."""
    data = request.form
    required_fields = ['appid', 'supported_languages', 'genres', 'peak_ccu', 'tags']
    if not all(field in data for field in required_fields):
        return api_response({"error": "Missing misc data"}, status=400)

    try:
        appid = int(request.form['appid'])
        supported_languages = json.loads(request.form['supported_languages'])
        genres = json.loads(request.form['genres'])
        tags = json.loads(request.form['tags'])
        peak_ccu = int(request.form['peak_ccu'])
    except Exception:
        return api_response(
            {"error": "Invalid JSON format in supported_languages, genres, or tags"},
            status=400
        )

    update_fields = {
        'metadata.supported_languages': supported_languages,
        'metadata.genres': genres,
        'metadata.tags': tags,
        'playtime.peak_ccu': peak_ccu,
        'last_misc_update_by': request.user.get('username', 'unknown'),
        'last_misc_update_at': datetime.utcnow()
    }

    games_collection.update_one({'appid': appid}, {'$set': update_fields}, upsert=True)
    # Debug: print the full game document after update
    updated_doc = games_collection.find_one({'appid': appid})
    print(f"[MISC DEBUG] After misc update for appid {appid}: {updated_doc}")
    log_action(request.user, "create", "misc", appid, update_fields, status=201)

    return api_response({"message": "Misc entry added successfully", "appid": appid}, status=201)


# ---------- UPDATE MISC ENTRY ----------
@misc_bp.route("/api/v1.0/games/misc/<int:appid>", methods=['PUT'])
@require_admin
def put_misc(appid):
    """Admin: Update an existing misc entry."""
    update_fields = {}
    # Debug: log received form data
    print(f"[MISC PUT] Received form: {dict(request.form)}")

    # Ensure metadata object exists
    doc = games_collection.find_one({'appid': appid})
    if doc is not None and 'metadata' not in doc:
        games_collection.update_one({'appid': appid}, {'$set': {'metadata': {}}})

    # Handle misc fields
    for field in ['supported_languages', 'genres', 'peak_ccu', 'tags']:
        if field in request.form:
            try:
                if field in ['supported_languages', 'genres', 'tags']:
                    update_fields[f"metadata.{field}"] = json.loads(request.form[field])
                elif field == 'peak_ccu':
                    update_fields["playtime.peak_ccu"] = int(request.form[field])
            except Exception:
                return api_response({"error": f"Invalid format for {field}"}, status=400)

    # Handle core fields
    if 'appid' in request.form:
        try:
            update_fields['appid'] = int(request.form['appid'])
        except Exception:
            return api_response({"error": "Invalid format for appid"}, status=400)
    if 'name' in request.form:
        update_fields['name'] = request.form['name']
    if 'developers' in request.form:
        try:
            update_fields['metadata.developers'] = json.loads(request.form['developers'])
        except Exception:
            return api_response({"error": "Invalid format for developers"}, status=400)
    if 'publishers' in request.form:
        try:
            update_fields['metadata.publishers'] = json.loads(request.form['publishers'])
        except Exception:
            return api_response({"error": "Invalid format for publishers"}, status=400)

    if not update_fields:
        return api_response({"error": "No fields to update"}, status=400)

    update_fields["last_updated_by"] = request.user.get("username", "unknown")
    update_fields["last_updated_at"] = datetime.utcnow()

    print(f"[MISC PUT] Update fields: {update_fields}")

    result = games_collection.update_one({'appid': appid}, {'$set': update_fields})
    if result.matched_count == 1:
        log_action(request.user, "update", "misc", appid, update_fields, status=200)
        return api_response({"message": f"Misc entry {appid} updated successfully"}, status=200)
    else:
        log_action(request.user, "update", "misc", appid, update_fields, status=404)
        return api_response({"error": "Misc entry not found"}, status=404)


# ---------- DELETE MISC ENTRY ----------
@misc_bp.route("/api/v1.0/games/misc/<int:appid>", methods=['DELETE'])
@require_admin
def delete_misc(appid):
    """Admin: Delete misc info for a game."""
    result = games_collection.update_one(
        {'appid': appid},
        {"$unset": {
            "metadata.supported_languages": "",
            "metadata.genres": "",
            "metadata.tags": "",
            "playtime.peak_ccu": ""
        }}
    )
    if result.matched_count == 1:
        log_action(request.user, "delete", "misc", appid, {"deleted": True}, status=200)
        return api_response({
            "message": f"Misc info for {appid} deleted successfully",
            "deleted_by": request.user.get("username", "unknown")
        }, status=200)
    else:
        log_action(request.user, "delete", "misc", appid, {"deleted": True}, status=404)
        return api_response({"error": "Misc entry not found"}, status=404)


# ============================================================
# DASHBOARD STATISTICS
# ============================================================
@misc_bp.route("/api/v1.0/dashboard/stats", methods=['GET'])
def get_dashboard_stats():
    """
    Get comprehensive dashboard statistics.
    Combines total games, total reviews, and recent review counts.
    Moves multiple frontend API calls into one backend endpoint.
    """
    # Total games
    total_games = games_collection.count_documents({})
    
    # Total reviews across all games
    pipeline_total = [
        {'$match': {'reviews.list': {'$exists': True}}},
        {'$project': {'review_count': {'$size': {'$ifNull': ['$reviews.list', []]}}}},
        {'$group': {'_id': None, 'total': {'$sum': '$review_count'}}}
    ]
    total_reviews_result = list(games_collection.aggregate(pipeline_total))
    total_reviews = total_reviews_result[0]['total'] if total_reviews_result else 0
    
    # Recent reviews (last hour)
    one_hour_ago = datetime.utcnow() - timedelta(hours=1)
    pipeline_recent = [
        {'$match': {'reviews.list': {'$exists': True, '$ne': []}}},
        {'$unwind': '$reviews.list'},
        {'$match': {'reviews.list.created_at': {'$gte': one_hour_ago}}},
        {'$count': 'recent_count'}
    ]
    recent_result = list(games_collection.aggregate(pipeline_recent))
    recent_hour_count = recent_result[0]['recent_count'] if recent_result else 0
    
    # Average price
    avg_price_pipeline = [
        {"$addFields": {"price_numeric": {"$toDouble": "$metadata.price"}}},
        {"$group": {"_id": None, "average_price": {"$avg": "$price_numeric"}}}
    ]
    avg_price_result = list(games_collection.aggregate(avg_price_pipeline))
    avg_price = round(avg_price_result[0]['average_price'], 2) if avg_price_result else 0
    
    # Top peak CCU game
    top_ccu_pipeline = [
        {"$match": {"playtime.peak_ccu": {"$exists": True, "$ne": None, "$gt": 0}}},
        {"$sort": {"playtime.peak_ccu": -1}},
        {"$limit": 1},
        {"$project": {"name": 1, "appid": 1, "peak_ccu": "$playtime.peak_ccu"}}
    ]
    top_ccu_result = list(games_collection.aggregate(top_ccu_pipeline))
    top_game = top_ccu_result[0] if top_ccu_result else None
    
    return api_response({
        'total_games': total_games,
        'total_reviews': total_reviews,
        'recent_hour_reviews': recent_hour_count,
        'average_price': avg_price,
        'top_peak_game': {
            'name': top_game['name'] if top_game else 'N/A',
            'appid': top_game['appid'] if top_game else None,
            'peak_ccu': int(top_game['peak_ccu']) if top_game else 0
        }
    })
