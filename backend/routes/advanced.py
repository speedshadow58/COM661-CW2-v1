from flask import Blueprint, request
from config import db
from utils import api_response, ensure_array, get_pagination_params, enrich_games_with_steam_prices

# Single unified collection
games_collection = db.steamGames

advanced_bp = Blueprint('advanced_bp', __name__)

# ============================================================
# ADVANCED GAME ANALYTICS ROUTES
# ============================================================

@advanced_bp.route("/api/v1.0/games/advanced/top", methods=['GET'])
def get_top_games():
    """
    Return top games ranked by a chosen metric (positive, metacritic_score, or peak_ccu).
    Example: /api/v1.0/games/advanced/top?metric=positive&limit=10
    
    For 'positive' metric: calculates review_score as percentage (matches games?sort=topRated)
    """
    metric = request.args.get('metric', 'positive')
    limit = int(request.args.get('limit', 10))

    valid_metrics = ['positive', 'metacritic_score', 'peak_ccu']
    if metric not in valid_metrics:
        return api_response({"error": f"Invalid metric. Choose from {valid_metrics}"}, status=400)

    # Sort by highest positive review count
    if metric == 'positive':
        top_games = list(
            games_collection.find(
                {}, {"_id": 0, "appid": 1, "name": 1, "metadata.price": 1,
                     "metadata.developers": 1, "metadata.publishers": 1,
                     "reviews.positive": 1, "reviews.negative": 1}
            ).sort("reviews.positive", -1).limit(limit)
        )
        
        # Normalize structure to match games page format
        normalized_games = []
        for game in top_games:
            normalized_games.append({
                "appid": game.get("appid"),
                "name": game.get("name"),
                "price": game.get("metadata", {}).get("price"),
                "developers": ensure_array(game.get("metadata", {}).get("developers")),
                "publishers": ensure_array(game.get("metadata", {}).get("publishers")),
                "reviews": game.get("reviews")
            })
        
        # Note: Steam enrichment removed - frontend will enrich with cached proxy
        return api_response(normalized_games, status=200)
    
    # Metacritic score metric
    if metric == 'metacritic_score':
        top_reviews = list(
            games_collection.find(
                {}, {"_id": 0, "appid": 1, "name": 1, "metadata.price": 1,
                     "reviews.metacritic_score": 1}
            ).sort("reviews.metacritic_score", -1).limit(limit)
        )
        return api_response(top_reviews, status=200)

    # Peak CCU metric
    top_games = list(
        games_collection.find(
            {}, {"_id": 0, "appid": 1, "name": 1, "metadata.price": 1,
                 "playtime.peak_ccu": 1}
        ).sort("playtime.peak_ccu", -1).limit(limit)
    )
    # Note: Steam enrichment removed - frontend will enrich with cached proxy
    return api_response(top_games, status=200)


# ============================================================
# SENTIMENT BREAKDOWN
# ============================================================

@advanced_bp.route("/api/v1.0/games/advanced/sentiment", methods=['GET'])
def get_sentiment_breakdown():
    """
    Returns sentiment breakdown per game based on Steam's official ratings.
    Example: /api/v1.0/games/advanced/sentiment?limit=10
    """
    limit = int(request.args.get('limit', 10))

    # Get games with Steam's official positive percentage
    reviews = list(
        games_collection.find(
            {"reviews.pct_pos_total": {"$exists": True, "$ne": None}},
            {"_id": 0, "appid": 1, "name": 1, "metadata.price": 1, "reviews.pct_pos_total": 1}
        ).sort("reviews.pct_pos_total", -1).limit(limit)
    )

    # Use Steam's official sentiment data
    for r in reviews:
        pct_pos = float(r.get("reviews", {}).get("pct_pos_total") or 0)
        r["positive_percent"] = round(pct_pos, 2)
        r["negative_percent"] = round(100 - pct_pos, 2)

    # Note: Steam enrichment removed - frontend will enrich with cached proxy
    return api_response(reviews, status=200)


# ============================================================
# VALUE FOR MONEY
# ============================================================

@advanced_bp.route("/api/v1.0/games/advanced/value", methods=['GET'])
def get_value_for_money():
    """
    Returns games ranked by value for money - uses same normalization as filter_games.
    Example: /api/v1.0/games/advanced/value?limit=10
    """
    limit = int(request.args.get('limit', 10))
    
    # Get games with price > 0 to calculate meaningful value scores
    query = {"metadata.price": {"$gt": 0}}
    
    # Query with limit to avoid loading all 89k games
    cursor = (
        games_collection.find(
            query,
            {
                "_id": 0,
                "appid": 1,
                "name": 1,
                "metadata.price": 1,
                "reviews.positive": 1,
                "reviews.negative": 1,
            },
        ).limit(limit * 100)  # Limit to avoid loading entire collection
    )

    # Calculate value scores
    data_to_return = []
    for game in cursor:
        pos = int(game.get("reviews", {}).get("positive", 0))
        neg = int(game.get("reviews", {}).get("negative", 0))
        total = pos + neg

        price = float(game.get("metadata", {}).get("price", 0))
        positive_ratio = (pos / total) if total > 0 else 0
        denom = price if price > 0.5 else 0.5
        value_score = (positive_ratio / denom) * 100

        data_to_return.append(
            {
                "appid": game.get("appid"),
                "name": game.get("name"),
                "price": price,
                "value_score": value_score,
                "positive_ratio": round(positive_ratio * 100, 2),  # Add for frontend
                "reviews": {
                    "positive": pos,
                    "negative": neg
                }
            }
        )

    # Sort by value_score descending and limit
    data_to_return.sort(key=lambda x: x["value_score"], reverse=True)
    data_to_return = data_to_return[:limit]

    # Note: Steam enrichment removed - frontend will enrich with cached proxy
    return api_response(data_to_return, status=200)

    return api_response(data_to_return, page_num, page_size, total_count)


# ============================================================
# SMART SEARCH
# ============================================================

@advanced_bp.route("/api/v1.0/games/advanced/search", methods=['GET'])
def search_games():
    """
    Smart search endpoint for finding games by multiple filters + text search + pagination.
    """
    q = request.args.get("q")
    developer = request.args.get("developer")
    genre = request.args.get("genre")
    tag = request.args.get("tag")
    price_min = float(request.args.get("price_min", 0))
    price_max = float(request.args.get("price_max", 1000))
    metacritic_min = int(request.args.get("metacritic_min", 0))
    sort_field = request.args.get("sort", "reviews.metacritic_score")
    order = request.args.get("order", "desc")

    page_num, page_size, page_start = get_pagination_params()

    query = {
        "metadata.price": {"$gte": price_min, "$lte": price_max},
        "$or": [{"reviews.metacritic_score": {"$gte": metacritic_min}}, {"reviews.metacritic_score": None}]
    }
    if q:
        query["name"] = {"$regex": q, "$options": "i"}
    if developer:
        query["metadata.developers"] = {"$regex": developer, "$options": "i"}
    if genre:
        query["metadata.genres"] = {"$regex": genre, "$options": "i"}
    if tag:
        query["metadata.tags"] = {"$regex": tag, "$options": "i"}

    sort_order = -1 if order == "desc" else 1

    results = list(
        games_collection.find(query, {
            "_id": 0, "appid": 1, "name": 1, "metadata.price": 1,
            "metadata.release_date": 1, "metadata.developers": 1,
            "metadata.genres": 1, "metadata.tags": 1,
            "reviews.metacritic_score": 1, "reviews.positive": 1, "reviews.negative": 1
        }).sort(sort_field, sort_order).skip(page_start).limit(page_size)
    )

    total_count = games_collection.count_documents(query)
    results = enrich_games_with_steam_prices(results)
    return api_response(results, page_num, page_size, total_count, status=200)


# ============================================================
# ENRICHED TOP GAMES (with Steam data included)
# ============================================================

@advanced_bp.route("/api/v1.0/games/advanced/top-enriched", methods=['GET'])
def get_top_games_enriched():
    """
    Return top games with Steam price data already included.
    Eliminates need for frontend to make separate Steam API calls.
    Example: /api/v1.0/games/advanced/top-enriched?metric=positive&limit=4
    """
    import requests
    import time
    
    metric = request.args.get('metric', 'positive')
    limit = int(request.args.get('limit', 10))

    valid_metrics = ['positive', 'metacritic_score', 'peak_ccu']
    if metric not in valid_metrics:
        return api_response({"error": f"Invalid metric. Choose from {valid_metrics}"}, status=400)

    # Get base game data
    if metric in ['positive', 'metacritic_score']:
        games = list(
            games_collection.find(
                {}, {"_id": 0, "appid": 1, "name": 1, "metadata": 1,
                     "playtime.peak_ccu": 1, "reviews": 1}
            ).sort(f"reviews.{metric}", -1).limit(limit)
        )
    else:
        games = list(
            games_collection.find(
                {}, {"_id": 0, "appid": 1, "name": 1, "metadata": 1,
                     "playtime.peak_ccu": 1, "reviews": 1}
            ).sort("playtime.peak_ccu", -1).limit(limit)
        )
    
    # Enrich with Steam data in parallel
    steam_url_template = "https://store.steampowered.com/api/appdetails?appids={}&filters=price_overview"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json"
    }
    
    for game in games:
        appid = game.get('appid')
        try:
            resp = requests.get(steam_url_template.format(appid), headers=headers, timeout=3)
            if resp.status_code == 200:
                data = resp.json()
                steam_data = data.get(str(appid), {}).get('data', {})
                price_overview = steam_data.get('price_overview')
                if price_overview:
                    game['price_overview'] = price_overview
                    game['price_gbp'] = price_overview.get('final', 0) / 100
            time.sleep(0.1)  # Rate limiting
        except Exception:
            pass  # Use existing price data
    
    return api_response(games, status=200)
