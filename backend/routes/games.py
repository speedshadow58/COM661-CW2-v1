from flask import Blueprint, request
import json
import ast
import requests
from datetime import datetime
from config import db
from utils import (
    clean_doc, clean_docs, get_pagination_params,
    api_response, normalize_metadata, require_auth, require_admin,
    log_action, ensure_array, enrich_games_with_steam_prices, enrich_with_steam_price
)

games_collection = db.steamGames
logs_col = db.action_logs

games_bp = Blueprint('games_bp', __name__)

# ---------------------------------------
# VALID LANGUAGE CODES
# ---------------------------------------
VALID_LANGUAGE_CODES = [
    "english", "spanish", "french", "german", "italian", "japanese", "korean",
    "russian", "portuguese", "chinese", "arabic", "turkish"
]

# ============================================================
# GAMES ROUTES (Public)
# ============================================================

@games_bp.route("/api/v1.0/games", methods=['GET'])
def get_games():
    """
    Return paginated list of all games with expanded details.
    Supports server-side sorting: ?sort=topRated|value|sentiment
    """
    page_num, page_size, page_start = get_pagination_params()
    sort_by = request.args.get('sort', '')

    # Base projection - only fields needed for list view
    projection = {
        '_id': 0,
        'appid': 1,
        'name': 1,
        'metadata.price': 1,
        'metadata.developers': 1,
        'metadata.publishers': 1,
        'metadata.tags': 1,
        'metadata.supported_languages': 1,
        'reviews.positive': 1,
        'reviews.negative': 1,
        'reviews.pct_pos_total': 1
    }

    # Handle sorting
    if sort_by == 'topRated':
        # Sort by highest positive review count, then paginate
        cursor = games_collection.find({}, projection).sort("reviews.positive", -1)
        total_count = games_collection.count_documents({})

        # Get paginated results
        paginated_games = list(cursor.skip(page_start).limit(page_size))

        # Normalize structure
        from utils import enrich_with_supported_languages
        normalized_games = []
        def extract_tags(val):
            if isinstance(val, dict):
                return list(val.keys())
            elif isinstance(val, list):
                result = []
                for t in val:
                    # If element is a stringified dict, parse and extract keys
                    if isinstance(t, str):
                        try:
                            parsed = ast.literal_eval(t)
                            if isinstance(parsed, dict):
                                result.extend(list(parsed.keys()))
                            elif isinstance(parsed, list):
                                result.extend([str(x) for x in parsed])
                            else:
                                result.append(str(parsed))
                        except Exception:
                            result.append(t)
                    elif isinstance(t, dict):
                        result.extend(list(t.keys()))
                    else:
                        result.append(str(t))
                return result
            elif isinstance(val, str):
                try:
                    parsed = ast.literal_eval(val)
                    return extract_tags(parsed)
                except Exception:
                    return [val]
            elif val is not None:
                return [str(val)]
            return []
        for game in paginated_games:
            enrich_with_supported_languages(game)
            raw_tags = game.get("metadata", {}).get("tags")
            tags = extract_tags(raw_tags)
            normalized_games.append({
                "appid": game.get("appid"),
                "name": game.get("name"),
                "price": game.get("metadata", {}).get("price"),
                "developers": ensure_array(game.get("metadata", {}).get("developers")),
                "publishers": ensure_array(game.get("metadata", {}).get("publishers")),
                "tags": tags,
                "supported_languages": ensure_array(game.get("metadata", {}).get("supported_languages")),
                "reviews": game.get("reviews")
            })

        # Note: Steam price enrichment removed for performance (use MongoDB price or Steam proxy endpoint)
        return api_response(normalized_games, page_num, page_size, total_count)
    
    elif sort_by == 'value':
        # Use value for money calculation
        all_games = list(games_collection.find({}, projection))
        from utils import enrich_with_supported_languages
        normalized_games = []
        for game in all_games:
            pos = int(game.get("reviews", {}).get("positive", 0))
            neg = int(game.get("reviews", {}).get("negative", 0))
            total = pos + neg
            positive_ratio = (pos / total) if total > 0 else 0
            price = float(game.get("metadata", {}).get("price", 0))
            if price > 0 and positive_ratio > 0:
                value_score = round((positive_ratio / price) * 1000, 2)
            else:
                value_score = 0
            if total >= 5:
                review_score = round((pos / total) * 100, 2)
            else:
                review_score = game.get("reviews", {}).get("pct_pos_total", 0)
            raw_tags = game.get("metadata", {}).get("tags")
            tags = extract_tags(raw_tags)
            normalized_games.append({
                "appid": game.get("appid"),
                "name": game.get("name"),
                "price": game.get("metadata", {}).get("price"),
                "developers": ensure_array(game.get("metadata", {}).get("developers")),
                "publishers": ensure_array(game.get("metadata", {}).get("publishers")),
                "tags": tags,
                "supported_languages": ensure_array(game.get("metadata", {}).get("supported_languages")),
                "review_score": review_score,
                "value_score": value_score
            })
        normalized_games.sort(key=lambda x: x.get('value_score', 0), reverse=True)
        total_count = len(normalized_games)
        data_to_return = normalized_games[page_start:page_start + page_size]
        # Note: Steam price enrichment removed for performance
        return api_response(data_to_return, page_num, page_size, total_count)
    
    elif sort_by == 'sentiment':
        # Use sentiment breakdown
        all_games = list(games_collection.find({}, projection))
        from utils import enrich_with_supported_languages
        normalized_games = []
        for game in all_games:
            pos = int(game.get("reviews", {}).get("positive", 0))
            neg = int(game.get("reviews", {}).get("negative", 0))
            total = pos + neg
            positive_percent = round((pos / total) * 100, 2) if total > 0 else 0
            if total >= 5:
                review_score = round((pos / total) * 100, 2)
            else:
                review_score = game.get("reviews", {}).get("pct_pos_total", 0)
            raw_tags = game.get("metadata", {}).get("tags")
            tags = extract_tags(raw_tags)
            normalized_games.append({
                "appid": game.get("appid"),
                "name": game.get("name"),
                "price": game.get("metadata", {}).get("price"),
                "developers": ensure_array(game.get("metadata", {}).get("developers")),
                "publishers": ensure_array(game.get("metadata", {}).get("publishers")),
                "tags": tags,
                "supported_languages": ensure_array(game.get("metadata", {}).get("supported_languages")),
                "review_score": review_score,
                "positive_percent": positive_percent
            })
        normalized_games.sort(key=lambda x: x.get('positive_percent', 0), reverse=True)
        total_count = len(normalized_games)
        data_to_return = normalized_games[page_start:page_start + page_size]
        return api_response(data_to_return, page_num, page_size, total_count)
    
    else:
        # Default: sorted by appid
        cursor = games_collection.find({}, projection).sort("appid", 1).skip(page_start).limit(page_size)
        
        data_to_return = []
        for game in cursor:
            pos = int(game.get("reviews", {}).get("positive", 0))
            neg = int(game.get("reviews", {}).get("negative", 0))
            total = pos + neg
            if total >= 5:
                review_score = round((pos / total) * 100, 2)
            else:
                review_score = game.get("reviews", {}).get("pct_pos_total")

            raw_tags = game.get("metadata", {}).get("tags")
            if isinstance(raw_tags, dict):
                tags = list(raw_tags.keys())
            else:
                tags = ensure_array(raw_tags)
            data_to_return.append({
                "appid": game.get("appid"),
                "name": game.get("name"),
                "price": game.get("metadata", {}).get("price"),
                "developers": ensure_array(game.get("metadata", {}).get("developers")),
                "publishers": ensure_array(game.get("metadata", {}).get("publishers")),
                "tags": tags,
                "supported_languages": ensure_array(game.get("metadata", {}).get("supported_languages")),
                "review_score": review_score
            })
        total_count = games_collection.count_documents({})

        # Note: Steam price enrichment removed for performance (prices are in MongoDB metadata.price)

        return api_response(data_to_return, page_num, page_size, total_count)


@games_bp.route("/api/v1.0/games/<int:appid>", methods=['GET'])
def get_game(appid):
    """Return a single game with fully normalized fields, flattened for consistency. Excludes reviews.list - use /games/<appid>/with-reviews for reviews."""
    game = games_collection.find_one({"appid": appid}, {"_id": 0, "reviews.list": 0})
    if not game:
        return api_response({"error": "Game not found"}, status=404)

    # Flatten metadata
    metadata = game.get("metadata", {})
    game.update(normalize_metadata(metadata, as_array=False))


    # Safely parse JSON-like strings for array fields and always ensure arrays
    for field in ["developers", "publishers", "genres", "tags", "supported_languages"]:
        value = game.get(field)
        if isinstance(value, str):
            try:
                parsed = ast.literal_eval(value)
                if isinstance(parsed, list):
                    game[field] = parsed
                elif isinstance(parsed, str):
                    game[field] = [parsed]
                else:
                    game[field] = []
            except Exception:
                game[field] = [value] if value else []
        elif isinstance(value, list):
            game[field] = value
        else:
            game[field] = []

    # Enrich supported_languages if missing
    from utils import enrich_with_supported_languages
    enrich_with_supported_languages(game)

    # Normalize tags to always be a list of strings
    def extract_tags(val):
        if isinstance(val, dict):
            return list(val.keys())
        elif isinstance(val, list):
            result = []
            for t in val:
                if isinstance(t, str):
                    try:
                        parsed = ast.literal_eval(t)
                        if isinstance(parsed, dict):
                            result.extend(list(parsed.keys()))
                        elif isinstance(parsed, list):
                            result.extend([str(x) for x in parsed])
                        else:
                            result.append(str(parsed))
                    except Exception:
                        result.append(t)
                elif isinstance(t, dict):
                    result.extend(list(t.keys()))
                else:
                    result.append(str(t))
            return result
        elif isinstance(val, str):
            try:
                parsed = ast.literal_eval(val)
                return extract_tags(parsed)
            except Exception:
                return [val]
        elif val is not None:
            return [str(val)]
        return []
    game['tags'] = extract_tags(game.get('tags', []))

    # Flatten description fields
    desc = game.get("description", {})
    game["short_description"] = desc.get("short_description", "")
    game["detailed_description"] = desc.get("detailed_description", "")
    game["about_the_game"] = desc.get("about_the_game", "")
    game.pop("description", None)  # optional: remove nested dict

    # Safely parse media screenshots & movies
    media = game.get("media", {})
    # Ensure 'media' key exists and is a dict
    if not isinstance(media, dict):
        media = {}
    game["media"] = media
    for key in ["screenshots", "movies"]:
        if key in media and isinstance(media[key], list):
            try:
                parsed = ast.literal_eval(media[key][0])
                game["media"][key] = parsed
            except Exception:
                game["media"][key] = []
        else:
            game["media"][key] = []

    # Reviews list excluded from this endpoint (use with-reviews endpoint)
    # Only include review stats
    reviews = game.get('reviews', {})
    if isinstance(reviews, dict):
        # Remove list if it somehow got through
        reviews.pop('list', None)
        game['reviews'] = reviews

    # Flatten and expose all relevant fields at the top level
    game['release_date'] = metadata.get('release_date', '')
    game['price'] = metadata.get('price', 0)
    game['positive'] = reviews.get('positive', 0)
    game['negative'] = reviews.get('negative', 0)
    game['metacritic_score'] = reviews.get('metacritic_score', None)
    playtime = game.get('playtime', {})
    game['peak_ccu'] = playtime.get('peak_ccu', 0)

    return api_response(game)

    # Flatten metadata
    metadata = game.get("metadata", {})
    game.update(normalize_metadata(metadata, as_array=False))

    # Safely parse JSON-like strings for array fields
    for field in ["developers", "publishers", "genres", "tags", "supported_languages"]:
        value = game.get(field)
        if isinstance(value, str):
            try:
                game[field] = ast.literal_eval(value)
            except Exception:
                game[field] = []
        # Ensure always an array (even if missing or malformed)
        if not isinstance(game.get(field), list):
            game[field] = []

    # Enrich supported_languages if missing
    from utils import enrich_with_supported_languages
    enrich_with_supported_languages(game)

    # Normalize tags to always be a list of strings
    def extract_tags(val):
        if isinstance(val, dict):
            return list(val.keys())
        elif isinstance(val, list):
            result = []
            for t in val:
                if isinstance(t, str):
                    try:
                        parsed = ast.literal_eval(t)
                        if isinstance(parsed, dict):
                            result.extend(list(parsed.keys()))
                        elif isinstance(parsed, list):
                            result.extend([str(x) for x in parsed])
                        else:
                            result.append(str(parsed))
                    except Exception:
                        result.append(t)
                elif isinstance(t, dict):
                    result.extend(list(t.keys()))
                else:
                    result.append(str(t))
            return result
        elif isinstance(val, str):
            try:
                parsed = ast.literal_eval(val)
                return extract_tags(parsed)
            except Exception:
                return [val]
        elif val is not None:
            return [str(val)]
        return []
    game['tags'] = extract_tags(game.get('tags', []))

    # Flatten description fields
    desc = game.get("description", {})
    game["short_description"] = desc.get("short_description", "")
    game["detailed_description"] = desc.get("detailed_description", "")
    game["about_the_game"] = desc.get("about_the_game", "")
    game.pop("description", None)  # optional: remove nested dict

    # Safely parse media screenshots & movies
    media = game.get("media", {})
    # Ensure 'media' key exists and is a dict
    if not isinstance(media, dict):
        media = {}
    game["media"] = media
    for key in ["screenshots", "movies"]:
        if key in media and isinstance(media[key], list):
            try:
                parsed = ast.literal_eval(media[key][0])
                game["media"][key] = parsed
            except Exception:
                game["media"][key] = []
        else:
            game["media"][key] = []

    # Reviews list excluded from this endpoint (use with-reviews endpoint)
    # Only include review stats
    reviews = game.get('reviews', {})
    if isinstance(reviews, dict):
        # Remove list if it somehow got through
        reviews.pop('list', None)
        game['reviews'] = reviews

    # Note: Steam price enrichment removed for performance (use metadata.price or Steam proxy endpoint)

    return api_response(game)


# ============================================================
# ADMIN ROUTES (Require Admin Privileges)
# ============================================================

@games_bp.route("/api/v1.0/games", methods=['POST'])
@require_admin
def post_game():
    """Add a new game (admin only)."""
    required_fields = ['appid', 'name', 'release_date', 'price']
    if not all(field in request.form for field in required_fields):
        return api_response({"error": "Missing required fields"}, status=400)

    try:
        new_game = {
            'appid': int(request.form['appid']),
            'name': request.form['name'].strip(),
            'metadata': {
                'release_date': request.form['release_date'].strip(),
                'price': float(request.form['price']),
                'developers': ensure_array(json.loads(request.form.get('developers', '[]'))),
                'publishers': ensure_array(json.loads(request.form.get('publishers', '[]'))),
                'genres': ensure_array(json.loads(request.form.get('genres', '[]'))),
                'tags': ensure_array(json.loads(request.form.get('tags', '[]'))),
                'supported_languages': ensure_array(json.loads(request.form.get('supported_languages', '[]')))
            },
            'description': {
                'short_description': request.form.get('short_description', '')
            },
            'playtime': {
                'peak_ccu': int(request.form.get('peak_ccu', 0))
            },
            'created_by': request.user["username"],
            'created_at': datetime.utcnow()
        }
    except Exception as e:
        return api_response({"error": f"Invalid data format: {str(e)}"}, status=400)

    games_collection.insert_one(new_game)
    log_action(request.user, "create", "game", new_game['appid'], new_game, status=201)
    return api_response({"message": "Game added successfully", "appid": new_game['appid']}, status=201)


@games_bp.route("/api/v1.0/games/<int:appid>", methods=['PUT'])
@require_admin
def put_game(appid):
    """Update existing game details (admin only)."""
    update_fields = {}
    editable_fields = [
        'name', 'release_date', 'price', 'short_description',
        'developers', 'publishers', 'genres', 'tags',
        'supported_languages', 'peak_ccu',
        'positive', 'negative', 'metacritic_score'
    ]

    for field in editable_fields:
        if field in request.form:
            value = request.form[field]

            if field in ['developers', 'publishers', 'genres', 'tags', 'supported_languages']:
                try:
                    value = ensure_array(json.loads(value))
                except Exception:
                    return api_response({"error": f"Invalid JSON for {field}"}, status=400)
                update_fields[f"metadata.{field}"] = value

            elif field == 'price':
                try:
                    value = float(value)
                except ValueError:
                    return api_response({"error": "Price must be numeric"}, status=400)
                update_fields["metadata.price"] = value

            elif field == 'release_date':
                update_fields["metadata.release_date"] = value

            elif field == 'short_description':
                update_fields["description.short_description"] = value

            elif field == 'peak_ccu':
                try:
                    value = int(value)
                except ValueError:
                    return api_response({"error": "peak_ccu must be integer"}, status=400)
                update_fields["playtime.peak_ccu"] = value

            elif field in ['positive', 'negative']:
                try:
                    value = int(value)
                except ValueError:
                    return api_response({"error": f"{field} must be integer"}, status=400)
                update_fields[f"reviews.{field}"] = value

            elif field == 'metacritic_score':
                try:
                    value = int(value)
                except ValueError:
                    return api_response({"error": "metacritic_score must be integer"}, status=400)
                update_fields["reviews.metacritic_score"] = value

            else:
                update_fields[field] = value

    if not update_fields:
        return api_response({"error": "No fields to update"}, status=400)

    update_fields["last_modified_by"] = request.user["username"]
    update_fields["last_modified_at"] = datetime.utcnow()

    result = games_collection.update_one({'appid': appid}, {'$set': update_fields})
    if result.matched_count == 1:
        log_action(request.user, "update", "game", appid, update_fields, status=200)
        return api_response({"message": "Game updated successfully"}, status=200)
    else:
        log_action(request.user, "update", "game", appid, update_fields, status=404)
        return api_response({"error": "Game not found"}, status=404)


@games_bp.route("/api/v1.0/games/<int:appid>", methods=['DELETE'])
@require_admin
def delete_game(appid):
    """Delete a game (admin only)."""
    result = games_collection.delete_one({'appid': appid})
    if result.deleted_count == 1:
        log_action(request.user, "delete", "game", appid, {"deleted_game": appid}, status=200)
        return api_response({"message": f"Game {appid} deleted by {request.user['username']}"}, status=200)
    else:
        log_action(request.user, "delete", "game", appid, {"deleted_game": appid}, status=404)
        return api_response({"error": "Game not found"}, status=404)


# ============================================================
# ADVANCED QUERIES (Filtering, Sorting, Aggregation)
# ============================================================

@games_bp.route("/api/v1.0/games/filter", methods=["GET"])
def filter_games():
    """Filter and sort games by genre, tag, developer, language, price range, or name; normalize like get_games."""
    query = {}

    # Get filter params
    genre = request.args.get("genre")
    tag = request.args.get("tag")
    developer = request.args.get("developer")
    language = request.args.get("language")
    price_min = request.args.get("price_min")
    price_max = request.args.get("price_max")
    name = request.args.get("name")

    # Build query
    if genre:
        query["metadata.genres"] = {"$regex": f"\\b{genre}\\b", "$options": "i"}
    if tag:
        query["metadata.tags"] = {"$regex": f"\\b{tag}\\b", "$options": "i"}
    if developer:
        query["metadata.developers"] = {"$regex": f"\\b{developer}\\b", "$options": "i"}
    if language:
        if language.lower() not in VALID_LANGUAGE_CODES:
            return api_response({"error": f"Invalid language code: {language}"}, status=400)
        query["metadata.supported_languages"] = {"$regex": f"\\b{language}\\b", "$options": "i"}
    if price_min or price_max:
        price_filter = {}
        if price_min:
            price_filter["$gte"] = float(price_min)
        if price_max:
            price_filter["$lte"] = float(price_max)
        query["metadata.price"] = price_filter
    if name:
        # partial, case-insensitive match on the game name
        query["name"] = {"$regex": name, "$options": "i"}

    # Pagination
    page_num, page_size, page_start = get_pagination_params()

    # Sorting with a small whitelist
    allowed_sorts = {"name", "appid", "metadata.price", "metadata.release_date", "playtime.peak_ccu"}
    sort_by = request.args.get("sort_by", "name")
    if sort_by not in allowed_sorts:
        sort_by = "name"
    order = request.args.get("order", "asc")
    sort_order = 1 if order == "asc" else -1


    # Query filtered games with needed fields for normalization
    cursor = (
        games_collection.find(
            query,
            {
                "_id": 0,
                "appid": 1,
                "name": 1,
                "metadata.price": 1,
                "metadata.developers": 1,
                "metadata.publishers": 1,
                "metadata.tags": 1,
                "metadata.supported_languages": 1,
                "reviews": 1
            },
        )
        .sort(sort_by, sort_order)
        .skip(page_start)
        .limit(page_size)
    )

    # Normalize like get_games
    def extract_tags(val):
        if isinstance(val, dict):
            return list(val.keys())
        elif isinstance(val, list):
            result = []
            for t in val:
                if isinstance(t, str):
                    try:
                        import ast
                        parsed = ast.literal_eval(t)
                        if isinstance(parsed, dict):
                            result.extend(list(parsed.keys()))
                        elif isinstance(parsed, list):
                            result.extend([str(x) for x in parsed])
                        else:
                            result.append(str(parsed))
                    except Exception:
                        result.append(t)
                elif isinstance(t, dict):
                    result.extend(list(t.keys()))
                else:
                    result.append(str(t))
            return result
        elif isinstance(val, str):
            try:
                import ast
                parsed = ast.literal_eval(val)
                return extract_tags(parsed)
            except Exception:
                return [val]
        elif val is not None:
            return [str(val)]
        return []

    data_to_return = []
    from utils import enrich_with_supported_languages
    for game in cursor:
        # Enrich supported_languages if missing or empty
        enrich_with_supported_languages(game)
        tags = extract_tags(game.get("metadata", {}).get("tags"))
        supported_languages = ensure_array(game.get("metadata", {}).get("supported_languages"))
        data_to_return.append(
            {
                "appid": game.get("appid"),
                "name": game.get("name"),
                "price": game.get("metadata", {}).get("price"),
                "developers": ensure_array(game.get("metadata", {}).get("developers")),
                "publishers": ensure_array(game.get("metadata", {}).get("publishers")),
                "tags": tags,
                "supported_languages": supported_languages,
                "reviews": game.get("reviews")
            }
        )

    # Total count for pagination
    total_count = games_collection.count_documents(query)

    return api_response(data_to_return, page_num, page_size, total_count)




@games_bp.route("/api/v1.0/games/stats", methods=['GET'])
def get_game_stats():
    """Return simple aggregated statistics (total, avg price, top peak ccu game, etc.)."""
    total_games = games_collection.count_documents({})

    avg_price_pipeline = [
        {"$addFields": {"price_numeric": {"$toDouble": "$metadata.price"}}},
        {"$group": {"_id": None, "average_price": {"$avg": "$price_numeric"}}}
    ]
    avg_price_result = list(games_collection.aggregate(avg_price_pipeline))
    avg_price = round(avg_price_result[0]['average_price'], 2) if avg_price_result else 0

    # Get game with highest peak_ccu
    top_ccu_pipeline = [
        {"$match": {"playtime.peak_ccu": {"$exists": True, "$ne": None, "$gt": 0}}},
        {"$sort": {"playtime.peak_ccu": -1}},
        {"$limit": 1},
        {"$project": {"name": 1, "peak_ccu": "$playtime.peak_ccu"}}
    ]
    top_ccu_result = list(games_collection.aggregate(top_ccu_pipeline))
    top_game_name = top_ccu_result[0]['name'] if top_ccu_result else "N/A"
    top_peak_ccu = int(top_ccu_result[0]['peak_ccu']) if top_ccu_result else 0

    stats = {
        "total_games": total_games,
        "average_price": avg_price,
        "top_peak_game": top_game_name,
        "top_peak_ccu": top_peak_ccu
    }
    return api_response(stats)


# ============================================================
# OPTIONAL ADMIN ENDPOINT – View logs
# ============================================================

@games_bp.route("/api/v1.0/admin/logs", methods=['GET'])
@require_admin
def get_action_logs():
    """Retrieve all logged admin actions."""
    page_num, page_size, page_start = get_pagination_params()
    cursor = logs_col.find({}, {'_id': 0}).sort('timestamp', -1).skip(page_start).limit(page_size)
    logs = list(cursor)
    total = logs_col.count_documents({})

    return api_response(logs, page_num, page_size, total)


# ============================================================
# ENRICHED GAME DATA ENDPOINT
# ============================================================

@games_bp.route("/api/v1.0/games/<int:appid>/enriched", methods=['GET'])
def get_enriched_game(appid):
    """
    Return a single game with Steam API details combined.
    Reduces frontend API calls by combining game data + Steam details.
    """
    # Get game from database
    game = games_collection.find_one({"appid": appid}, {"_id": 0})
    if not game:
        return api_response({"error": "Game not found"}, status=404)

    # Flatten and normalize game data (same as get_game)
    metadata = game.get("metadata", {})
    game.update(normalize_metadata(metadata, as_array=False))

    for field in ["developers", "publishers", "genres", "tags", "supported_languages"]:
        value = game.get(field)
        if isinstance(value, str):
            try:
                game[field] = ast.literal_eval(value)
            except Exception:
                game[field] = []

    desc = game.get("description", {})
    game["short_description"] = desc.get("short_description", "")
    game["detailed_description"] = desc.get("detailed_description", "")
    game["about_the_game"] = desc.get("about_the_game", "")
    game.pop("description", None)

    media = game.get("media", {})
    for key in ["screenshots", "movies"]:
        if key in media and isinstance(media[key], list):
            try:
                parsed = ast.literal_eval(media[key][0])
                game["media"][key] = parsed
            except Exception:
                game["media"][key] = []
        else:
            game["media"][key] = []

    reviews = game.get('reviews', {})
    if isinstance(reviews, dict) and isinstance(reviews.get('list'), list):
        reviews['list'] = [
            {**r, '_id': str(r['_id']) if '_id' in r and r['_id'] else None}
            for r in reviews['list']
        ]
        game['reviews'] = reviews

    game = enrich_with_steam_price(game)

    # Fetch Steam details from Steam API (or use internal proxy)
    try:
        steam_url = f"https://store.steampowered.com/api/appdetails?appids={appid}"
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept": "application/json"
        }
        resp = requests.get(steam_url, headers=headers, timeout=5)
        if resp.status_code == 200:
            steam_data = resp.json()
            game['steam_details'] = steam_data.get(str(appid), {}).get('data', {})
    except Exception as e:
        game['steam_details'] = None
        game['steam_error'] = str(e)

    # Add image URLs
    game['image_urls'] = {
        "header": f"https://cdn.cloudflare.steamstatic.com/steam/apps/{appid}/header.jpg",
        "capsule": f"https://cdn.cloudflare.steamstatic.com/steam/apps/{appid}/capsule_616x353.jpg",
        "library_600x900": f"https://cdn.cloudflare.steamstatic.com/steam/apps/{appid}/library_600x900.jpg",
        "library_hero": f"https://cdn.cloudflare.steamstatic.com/steam/apps/{appid}/library_hero.jpg",
        "logo": f"https://cdn.cloudflare.steamstatic.com/steam/apps/{appid}/logo.png"
    }

    return api_response(game)

