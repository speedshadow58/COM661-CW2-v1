import time
import requests
from flask import Blueprint, jsonify, request, make_response

steam_proxy_bp = Blueprint("steam_proxy", __name__)

# Cache configuration
CACHE_TTL = 60 * 60  # 1 hour (3600 seconds)
_cache = {}  # {cache_key: (expires_at, payload)}

def cleanup_expired_cache():
    """Remove expired entries from cache to prevent memory bloat"""
    now = time.time()
    expired_keys = [key for key, (expires_at, _) in _cache.items() if expires_at <= now]
    for key in expired_keys:
        del _cache[key]

def cached_request(cache_key: str, url: str, params: dict = None, headers: dict = None, ttl: int = CACHE_TTL):
    """Generic cached HTTP request helper"""
    now = time.time()
    
    # Cleanup expired cache periodically
    if len(_cache) > 100 and int(now) % 100 == 0:
        cleanup_expired_cache()
    
    # Check cache first
    cached = _cache.get(cache_key)
    if cached and cached[0] > now:
        return cached[1], True, int(cached[0] - now)
    
    # Fetch from API
    default_headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        "Accept": "application/json",
    }
    if headers:
        default_headers.update(headers)
    
    try:
        resp = requests.get(url, params=params, headers=default_headers, timeout=8)
        if resp.status_code != 200:
            return {"error": "api_fetch_failed", "status": resp.status_code}, False, 0
        
        data = resp.json()
        _cache[cache_key] = (now + ttl, data)
        return data, False, ttl
    
    except requests.Timeout:
        return {"error": "api_request_timeout"}, False, 0
    except requests.RequestException as e:
        return {"error": "api_request_failed", "message": str(e)}, False, 0

@steam_proxy_bp.route("/api/steam/<int:appid>")
def steam_details(appid: int):
    """
    Proxy endpoint for Steam appdetails API with 1-hour caching.
    Avoids CORS issues and reduces API calls.
    Returns cache status in response headers.
    """
    url = "https://store.steampowered.com/api/appdetails"
    params = {
        "appids": appid,
        "filters": "basic,movies,screenshots,price_overview,developers,publishers,genres,release_date,achievements",
    }
    
    data, is_cached, ttl = cached_request(f"details_{appid}", url, params)
    
    response = make_response(jsonify(data))
    response.headers['X-Cache-Status'] = 'HIT' if is_cached else 'MISS'
    response.headers['X-Cache-TTL'] = str(ttl)
    response.headers['Cache-Control'] = f'public, max-age={ttl}'
    return response

@steam_proxy_bp.route("/api/steam/<int:appid>/screenshots")
def steam_screenshots(appid: int):
    """Get Steam screenshots for a game"""
    url = "https://store.steampowered.com/api/appdetails"
    params = {"appids": appid, "filters": "screenshots"}
    
    data, is_cached, ttl = cached_request(f"screenshots_{appid}", url, params)
    
    response = make_response(jsonify(data))
    response.headers['X-Cache-Status'] = 'HIT' if is_cached else 'MISS'
    response.headers['X-Cache-TTL'] = str(ttl)
    response.headers['Cache-Control'] = f'public, max-age={ttl}'
    return response

@steam_proxy_bp.route("/api/steam/<int:appid>/trailers")
def steam_trailers(appid: int):
    """Get Steam trailers/movies for a game"""
    url = "https://store.steampowered.com/api/appdetails"
    params = {"appids": appid, "filters": "movies"}
    
    data, is_cached, ttl = cached_request(f"trailers_{appid}", url, params)
    
    response = make_response(jsonify(data))
    response.headers['X-Cache-Status'] = 'HIT' if is_cached else 'MISS'
    response.headers['X-Cache-TTL'] = str(ttl)
    response.headers['Cache-Control'] = f'public, max-age={ttl}'
    return response

@steam_proxy_bp.route("/api/steam/<int:appid>/achievements")
def steam_achievements(appid: int):
    """Get Steam achievement schema for a game"""
    steam_api_key = '99D5B654C623A256715DF472ADA239A7'
    url = "https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/"
    params = {"key": steam_api_key, "appid": appid}
    
    data, is_cached, ttl = cached_request(f"achievements_{appid}", url, params)
    
    response = make_response(jsonify(data))
    response.headers['X-Cache-Status'] = 'HIT' if is_cached else 'MISS'
    response.headers['X-Cache-TTL'] = str(ttl)
    response.headers['Cache-Control'] = f'public, max-age={ttl}'
    return response

@steam_proxy_bp.route("/api/steam/<int:appid>/achievement-percentages")
def steam_achievement_percentages(appid: int):
    """Get Steam global achievement percentages for a game"""
    url = "https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/"
    params = {"gameid": appid}
    
    data, is_cached, ttl = cached_request(f"ach_pct_{appid}", url, params)
    
    response = make_response(jsonify(data))
    response.headers['X-Cache-Status'] = 'HIT' if is_cached else 'MISS'
    response.headers['X-Cache-TTL'] = str(ttl)
    response.headers['Cache-Control'] = f'public, max-age={ttl}'
    return response

@steam_proxy_bp.route("/api/steam/search")
def steam_search():
    """Search for Steam games by name"""
    name = request.args.get('q', '')
    if not name:
        return jsonify({"error": "query parameter 'q' is required"}), 400
    
    url = f"https://steamcommunity.com/actions/SearchApps/{requests.utils.quote(name)}"
    
    data, is_cached, ttl = cached_request(f"search_{name}", url, ttl=300)  # 5 min cache for searches
    
    response = make_response(jsonify(data))
    response.headers['X-Cache-Status'] = 'HIT' if is_cached else 'MISS'
    response.headers['X-Cache-TTL'] = str(ttl)
    response.headers['Cache-Control'] = f'public, max-age={ttl}'
    return response

@steam_proxy_bp.route("/api/steam/<int:appid>/images")
def steam_images(appid: int):
    """Get Steam CDN image URLs for a game"""
    return jsonify({
        "header": f"https://cdn.cloudflare.steamstatic.com/steam/apps/{appid}/header.jpg",
        "capsule": f"https://cdn.cloudflare.steamstatic.com/steam/apps/{appid}/capsule_616x353.jpg",
        "library_600x900": f"https://cdn.cloudflare.steamstatic.com/steam/apps/{appid}/library_600x900.jpg",
        "library_hero": f"https://cdn.cloudflare.steamstatic.com/steam/apps/{appid}/library_hero.jpg",
        "logo": f"https://cdn.cloudflare.steamstatic.com/steam/apps/{appid}/logo.png"
    })


@steam_proxy_bp.route("/api/steam/batch", methods=['POST'])
def steam_batch():
    """
    Batch fetch Steam details for multiple games.
    Eliminates need for frontend to make multiple parallel API calls.
    
    POST body: { "appids": [730, 570, 440] }
    Returns: { "730": {...}, "570": {...}, "440": {...} }
    """
    data = request.get_json()
    if not data or 'appids' not in data:
        return jsonify({"error": "appids array required in request body"}), 400
    
    appids = data['appids']
    if not isinstance(appids, list) or len(appids) == 0:
        return jsonify({"error": "appids must be a non-empty array"}), 400
    
    if len(appids) > 50:
        return jsonify({"error": "Maximum 50 appids per request"}), 400
    
    results = {}
    url_template = "https://store.steampowered.com/api/appdetails"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json"
    }
    
    for appid in appids:
        now = time.time()
        cache_key = f"details_{appid}"
        
        # Check cache
        cached = _cache.get(cache_key)
        if cached and cached[0] > now:
            results[str(appid)] = cached[1]
            continue
        
        # Fetch from Steam
        try:
            params = {
                "appids": appid,
                "filters": "basic,movies,screenshots,price_overview,developers,publishers,genres,release_date,achievements"
            }
            resp = requests.get(url_template, params=params, headers=headers, timeout=5)
            if resp.status_code == 200:
                data = resp.json()
                _cache[cache_key] = (now + CACHE_TTL, data)
                results[str(appid)] = data
            else:
                results[str(appid)] = {"error": "fetch_failed"}
            
            time.sleep(0.1)  # Rate limiting
        except Exception as e:
            results[str(appid)] = {"error": str(e)}
    
    return jsonify(results)

