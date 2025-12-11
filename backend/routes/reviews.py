from flask import Blueprint, request
from bson import ObjectId
from datetime import datetime
from config import db
from utils import clean_doc, get_pagination_params, api_response, require_auth, log_action

games_collection = db.steamGames
reviews_bp = Blueprint('reviews_bp', __name__)

def _calc_stats(reviews_list: list):
    total = len(reviews_list)
    positive = sum(1 for r in reviews_list if r.get('rating', 0) >= 50)
    negative = total - positive
    snippet = reviews_list[-1].get('comment', '') if reviews_list else ''
    return {
        'reviews.num_reviews_total': total,
        'reviews.positive': positive,
        'reviews.negative': negative,
        'reviews.review_snippet': snippet,
    }

def _serialize_reviews(reviews_list: list):
    return [
        {**r, '_id': str(r['_id']) if '_id' in r and r['_id'] else None}
        for r in reviews_list
    ]

def _user_can_modify(review_entry: dict, user: dict):
    return user.get('role') == 'admin' or review_entry.get('created_by') == user.get('user_id')

# ---------- ADD NEW REVIEW ----------
@reviews_bp.route("/api/v1.0/games/<int:appid>/reviews", methods=['POST'])
def post_review(appid):
    required_fields = ['comment', 'rating']
    if not all(field in request.form for field in required_fields):
        return api_response({"error": "Missing review data (comment, rating required)"}, status=400)

    game = games_collection.find_one({'appid': appid})
    if not game:
        return api_response({"error": "Game not found"}, status=404)

    try:
        rating = int(request.form['rating'])
    except ValueError:
        return api_response({"error": "Invalid rating value"}, status=400)

    # Allow anonymous reviews or use auth if provided
    username = request.form.get('username') or 'Anonymous'
    created_by = None
    
    # Check if user is authenticated (optional)
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header.split(" ")[1]
        try:
            import jwt
            from config import JWT_SECRET_KEY
            payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=["HS256"])
            username = payload.get('username', username)
            created_by = payload.get('user_id')
        except:
            pass  # Continue as anonymous if token invalid

    review_entry = {
        '_id': ObjectId(),
        'username': username,
        'comment': request.form['comment'],
        'rating': rating,
        'created_by': created_by,
        'created_at': datetime.utcnow()
    }

    games_collection.update_one({'appid': appid}, {'$push': {'reviews.list': review_entry}})
    updated = games_collection.find_one({'appid': appid}, {"_id": 0, "name": 1, "reviews": 1})
    reviews_list = updated.get('reviews', {}).get('list', [])
    stats = _calc_stats(reviews_list)

    # PRESERVE Steam review data (pct_pos_total)
    existing_reviews = game.get('reviews', {})
    pct_pos_total = existing_reviews.get('pct_pos_total')
    
    update_dict = {
        **stats,
        'reviews.last_modified_at': datetime.utcnow(),
        'reviews.last_modified_by': created_by
    }
    
    # Include pct_pos_total if it exists
    if pct_pos_total is not None:
        update_dict['reviews.pct_pos_total'] = pct_pos_total

    games_collection.update_one(
        {'appid': appid},
        {'$set': update_dict}
    )

    log_action(request.user, "create", "review", appid, review_entry, status=201)

    return api_response({
        "message": "Review added successfully",
        "review": {**review_entry, '_id': str(review_entry['_id'])},
        "game": {"appid": appid, "name": updated.get('name', 'Unknown Game')}
    }, status=201)

# ---------- GET ALL REVIEWS FOR A GAME ----------
@reviews_bp.route("/api/v1.0/games/<int:appid>/reviews", methods=['GET'])
def get_reviews(appid):
    game = clean_doc(games_collection.find_one({'appid': appid}, {"_id": 0}))
    if not game:
        return api_response({"error": "Game not found"}, status=404)

    reviews_data = game.get("reviews", {})
    list_raw = reviews_data.get("list", [])
    serialized_list = _serialize_reviews(list_raw)

    return api_response({
        "game": {"appid": appid, "name": game.get("name")},
        "reviews": {
            **{k: v for k, v in reviews_data.items() if k != "list"},
            "list": serialized_list
        }
    })

# ---------- GET ALL REVIEWS (ALL GAMES) ----------
@reviews_bp.route("/api/v1.0/games/reviews", methods=['GET'])
def get_all_reviews():
    page_num, page_size, page_start = get_pagination_params()
    cursor = games_collection.find(
        {"reviews": {"$exists": True}},
        {"_id": 0, "appid": 1, "name": 1, "reviews": 1}
    ).skip(page_start).limit(page_size)

    output = []
    for doc in cursor:
        reviews_data = doc.get("reviews", {})
        reviews_list = _serialize_reviews(reviews_data.get("list", []))
        output.append({
            "appid": doc.get("appid"),
            "name": doc.get("name"),
            "reviews": {**{k: v for k, v in reviews_data.items() if k != "list"}, "list": reviews_list}
        })

    total_count = games_collection.count_documents({"reviews": {"$exists": True}})
    return api_response(output, page_num, page_size, total_count)

# ---------- GET GAME WITH REVIEWS ----------
@reviews_bp.route("/api/v1.0/games/<int:appid>/with-reviews", methods=['GET'])
def get_game_with_reviews(appid):
    game = games_collection.find_one({'appid': appid})
    if not game:
        return api_response({"error": "Game not found"}, status=404)

    reviews = game.get('reviews', {})
    if isinstance(reviews, dict) and isinstance(reviews.get('list'), list):
        reviews['list'] = [
            {**r, '_id': str(r['_id']) if '_id' in r and r['_id'] else None}
            for r in reviews['list']
        ]
        game['reviews'] = reviews

    return api_response(clean_doc(game))

# ---------- UPDATE REVIEW ----------
@reviews_bp.route("/api/v1.0/games/<int:appid>/reviews", defaults={'review_id': None}, methods=['PUT'])
@reviews_bp.route("/api/v1.0/games/<int:appid>/reviews/<string:review_id>", methods=['PUT'])
@require_auth
def put_review(appid, review_id):
    review_id = review_id or request.form.get('review_id')
    if not review_id:
        return api_response({"error": "review_id is required"}, status=400)

    if 'comment' not in request.form and 'rating' not in request.form:
        return api_response({"error": "No fields to update (comment and/or rating required)"}, status=400)

    try:
        rating = int(request.form['rating']) if 'rating' in request.form else None
    except ValueError:
        return api_response({"error": "Invalid rating value"}, status=400)

    game = games_collection.find_one({'appid': appid})
    if not game:
        return api_response({"error": "Game not found"}, status=404)

    reviews_list = game.get('reviews', {}).get('list', [])
    target = next((r for r in reviews_list if str(r.get('_id')) == review_id), None)
    if not target:
        return api_response({"error": "Review not found"}, status=404)

    if not _user_can_modify(target, request.user):
        return api_response({"error": "Not authorized to edit this review"}, status=403)

    if 'comment' in request.form:
        target['comment'] = request.form['comment']
    if rating is not None:
        target['rating'] = rating
    target['updated_at'] = datetime.utcnow()
    target['updated_by'] = request.user.get('user_id')

    stats = _calc_stats(reviews_list)
    
    # PRESERVE Steam review data (pct_pos_total)
    existing_reviews = game.get('reviews', {})
    pct_pos_total = existing_reviews.get('pct_pos_total')
    
    update_dict = {
        'reviews.list': reviews_list,
        **stats,
        'reviews.last_modified_at': datetime.utcnow(),
        'reviews.last_modified_by': request.user.get('user_id')
    }
    
    # Include pct_pos_total if it exists
    if pct_pos_total is not None:
        update_dict['reviews.pct_pos_total'] = pct_pos_total
    
    games_collection.update_one(
        {'appid': appid},
        {'$set': update_dict}
    )

    log_action(request.user, "update", "review", appid, {"review_id": review_id}, status=200)

    # Serialize the target review's _id
    serialized_target = {**target, '_id': str(target['_id']) if '_id' in target and target['_id'] else None}

    return api_response({
        "message": "Review updated successfully",
        "review": serialized_target,
        "reviews": {**{k: v for k, v in stats.items()}, "list": _serialize_reviews(reviews_list)}
    }, status=200)

# ---------- DELETE REVIEW ----------
@reviews_bp.route("/api/v1.0/games/<int:appid>/reviews/<string:review_id>", methods=['DELETE'])
@require_auth
def delete_review(appid, review_id):
    game = games_collection.find_one({'appid': appid})
    if not game:
        return api_response({"error": "Game not found"}, status=404)

    reviews_list = game.get('reviews', {}).get('list', [])
    idx = next((i for i, r in enumerate(reviews_list) if str(r.get('_id')) == review_id), None)
    if idx is None:
        return api_response({"error": "Review not found"}, status=404)

    target = reviews_list[idx]
    if not _user_can_modify(target, request.user):
        return api_response({"error": "Not authorized to delete this review"}, status=403)

    reviews_list.pop(idx)
    stats = _calc_stats(reviews_list)
    
    # PRESERVE Steam review data (pct_pos_total)
    existing_reviews = game.get('reviews', {})
    pct_pos_total = existing_reviews.get('pct_pos_total')
    
    update_dict = {
        'reviews.list': reviews_list,
        **stats,
        'reviews.last_modified_at': datetime.utcnow(),
        'reviews.last_modified_by': request.user.get('user_id')
    }
    
    # Include pct_pos_total if it exists
    if pct_pos_total is not None:
        update_dict['reviews.pct_pos_total'] = pct_pos_total

    games_collection.update_one(
        {'appid': appid},
        {'$set': update_dict}
    )

    log_action(request.user, "delete", "review", appid, {"review_id": review_id}, status=200)

    return api_response({
        "message": f"Review {review_id} deleted successfully",
        "deleted_by": request.user.get('username', 'unknown'),
        "reviews": {**{k: v for k, v in stats.items()}, "list": _serialize_reviews(reviews_list)}
    }, status=200)


# ---------- GET REVIEW STATISTICS ----------
@reviews_bp.route("/api/v1.0/games/<int:appid>/reviews/stats", methods=['GET'])
def get_review_stats(appid):
    """
    Calculate review statistics for a game.
    Moves calculation logic from frontend to backend.
    """
    game = games_collection.find_one({'appid': appid}, {'reviews': 1, 'name': 1})
    if not game:
        return api_response({"error": "Game not found"}, status=404)
    
    reviews_data = game.get('reviews', {})
    reviews_list = reviews_data.get('list', [])
    
    positive = reviews_data.get('positive', 0)
    negative = reviews_data.get('negative', 0)
    total = positive + negative
    
    # Calculate percentages
    positive_pct = round((positive / total * 100), 2) if total > 0 else 0
    negative_pct = round((negative / total * 100), 2) if total > 0 else 0
    
    # Rating distribution
    rating_distribution = {
        '0-20': 0,
        '21-40': 0,
        '41-60': 0,
        '61-80': 0,
        '81-100': 0
    }
    
    for review in reviews_list:
        rating = review.get('rating', 0)
        if rating <= 20:
            rating_distribution['0-20'] += 1
        elif rating <= 40:
            rating_distribution['21-40'] += 1
        elif rating <= 60:
            rating_distribution['41-60'] += 1
        elif rating <= 80:
            rating_distribution['61-80'] += 1
        else:
            rating_distribution['81-100'] += 1
    
    # Average rating
    avg_rating = 0
    if reviews_list:
        total_rating = sum(r.get('rating', 0) for r in reviews_list)
        avg_rating = round(total_rating / len(reviews_list), 2)
    
    return api_response({
        'game': {'appid': appid, 'name': game.get('name', 'Unknown')},
        'total_reviews': total,
        'positive': positive,
        'negative': negative,
        'positive_pct': positive_pct,
        'negative_pct': negative_pct,
        'average_rating': avg_rating,
        'rating_distribution': rating_distribution,
        'metacritic_score': reviews_data.get('metacritic_score', 0),
        'num_reviews_total': reviews_data.get('num_reviews_total', 0)
    })


# ---------- FILTER & SORT REVIEWS ----------
@reviews_bp.route("/api/v1.0/games/<int:appid>/reviews/filtered", methods=['GET'])
def get_filtered_reviews(appid):
    """
    Get filtered and sorted reviews for a game.
    Moves filtering/sorting logic from frontend to backend.
    """
    game = games_collection.find_one({'appid': appid}, {'reviews': 1, 'name': 1})
    if not game:
        return api_response({"error": "Game not found"}, status=404)
    
    reviews_data = game.get('reviews', {})
    reviews_list = reviews_data.get('list', [])
    
    # Get filter and sort params
    filter_type = request.args.get('filter', 'all')  # all, positive, negative
    sort_by = request.args.get('sort', 'date')  # date, rating, username
    
    # Filter reviews
    if filter_type == 'positive':
        reviews_list = [r for r in reviews_list if r.get('rating', 0) >= 50]
    elif filter_type == 'negative':
        reviews_list = [r for r in reviews_list if r.get('rating', 0) < 50]
    
    # Sort reviews
    if sort_by == 'rating':
        reviews_list = sorted(reviews_list, key=lambda x: x.get('rating', 0), reverse=True)
    elif sort_by == 'username':
        reviews_list = sorted(reviews_list, key=lambda x: x.get('username', '').lower())
    else:  # date
        reviews_list = sorted(reviews_list, key=lambda x: x.get('created_at', datetime.min), reverse=True)
    
    return api_response({
        'game': {'appid': appid, 'name': game.get('name', 'Unknown')},
        'filter': filter_type,
        'sort': sort_by,
        'count': len(reviews_list),
        'reviews': _serialize_reviews(reviews_list)
    })


# ---------- GET RECENT REVIEWS (ALL GAMES) ----------
@reviews_bp.route("/api/v1.0/reviews/recent", methods=['GET'])
def get_recent_reviews():
    """
    Get recent reviews across all games with automatic flattening and sorting.
    Returns most recent reviews and count of reviews in last hour.
    Moves complex frontend logic to backend.
    """
    limit = int(request.args.get('limit', 6))
    
    # Aggregation to get all reviews from all games
    pipeline = [
        {'$match': {'reviews.list': {'$exists': True, '$ne': []}}},
        {'$unwind': '$reviews.list'},
        {'$project': {
            '_id': 0,
            'appid': 1,
            'name': 1,
            'review': '$reviews.list'
        }},
        {'$sort': {'review.created_at': -1}},
        {'$limit': 100}  # Get more for hour calculation
    ]
    
    results = list(games_collection.aggregate(pipeline))
    
    # Flatten and enrich reviews
    all_reviews = []
    for item in results:
        review = item.get('review', {})
        all_reviews.append({
            **review,
            '_id': str(review.get('_id')) if review.get('_id') else None,
            'gameName': item.get('name', 'Unknown Game'),
            'gameAppid': item.get('appid')
        })
    
    # Calculate reviews in last hour
    from datetime import timedelta
    one_hour_ago = datetime.utcnow() - timedelta(hours=1)
    recent_count = sum(1 for r in all_reviews if r.get('created_at') and r['created_at'] >= one_hour_ago)
    
    return api_response({
        'reviews': all_reviews[:limit],
        'total_count': len(all_reviews),
        'recent_hour_count': recent_count
    })


# ---------- ADMIN: GET ALL REVIEWS WITH SEARCH ----------
@reviews_bp.route("/api/v1.0/admin/reviews", methods=['GET'])
def get_admin_reviews():
    """
    Get all reviews with server-side search and pagination.
    Moves admin search/filter logic from frontend to backend.
    """
    from utils import require_auth
    
    # Get pagination params
    page = int(request.args.get('page', 1))
    per_page = int(request.args.get('per_page', 20))
    search = request.args.get('search', '').strip()
    
    # Aggregation to flatten all reviews
    pipeline = [
        {'$match': {'reviews.list': {'$exists': True, '$ne': []}}},
        {'$unwind': '$reviews.list'},
        {'$project': {
            '_id': 0,
            'appid': 1,
            'name': 1,
            'review': '$reviews.list'
        }}
    ]
    
    results = list(games_collection.aggregate(pipeline))
    
    # Flatten reviews
    all_reviews = []
    for item in results:
        review = item.get('review', {})
        all_reviews.append({
            **review,
            '_id': str(review.get('_id')) if review.get('_id') else None,
            'gameName': item.get('name', 'Unknown Game'),
            'gameAppid': item.get('appid')
        })
    
    # Server-side search filtering
    if search:
        search_lower = search.lower()
        all_reviews = [
            r for r in all_reviews
            if (r.get('username', '').lower().find(search_lower) >= 0 or
                r.get('comment', '').lower().find(search_lower) >= 0 or
                r.get('gameName', '').lower().find(search_lower) >= 0)
        ]
    
    # Calculate pagination
    total_count = len(all_reviews)
    total_pages = max(1, (total_count + per_page - 1) // per_page)
    start = (page - 1) * per_page
    end = start + per_page
    paginated = all_reviews[start:end]
    
    return api_response({
        'reviews': paginated,
        'pagination': {
            'page': page,
            'per_page': per_page,
            'total_results': total_count,
            'total_pages': total_pages
        }
    })


