
import sys
import os
import requests
import time
# Ensure backend/ is in sys.path for config import
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from config import db

games_collection = db.steamGames
STEAM_API_URL = "https://store.steampowered.com/api/appdetails?appids={appid}&l=english"

def fetch_supported_languages(appid):
    try:
        url = STEAM_API_URL.format(appid=appid)
        resp = requests.get(url, timeout=10)
        data = resp.json()
        game_data = data.get(str(appid), {}).get('data', {})
        languages_str = game_data.get('supported_languages', '')
        # Split by comma, clean up whitespace and HTML tags
        langs = [lang.strip() for lang in languages_str.replace('<strong>', '').replace('</strong>', '').split(',') if lang.strip()]
        return langs
    except Exception as e:
        print(f"Error fetching languages for appid {appid}: {e}")
        return []

def main():
    games = list(games_collection.find({}))
    for game in games:
        appid = game.get('appid')
        if not appid:
            continue
        # Only update if missing or empty
        meta = game.get('metadata', {})
        if not meta.get('supported_languages'):
            langs = fetch_supported_languages(appid)
            if langs:
                games_collection.update_one({'appid': appid}, {'$set': {'metadata.supported_languages': langs}})
                print(f"Updated appid {appid} with languages: {langs}")
            time.sleep(1)  # Be kind to Steam API

if __name__ == "__main__":
    main()
