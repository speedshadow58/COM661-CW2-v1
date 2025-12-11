import time
import requests
from config import db

games_collection = db.steamGames
STEAM_API_URL = "https://store.steampowered.com/api/appdetails?appids={appid}&l=english"
SLEEP_BETWEEN_GAMES = 1  # seconds
SLEEP_BETWEEN_RUNS = 3600  # 1 hour

def fetch_supported_languages(appid):
    try:
        url = STEAM_API_URL.format(appid=appid)
        resp = requests.get(url, timeout=10)
        data = resp.json()
        game_data = data.get(str(appid), {}).get('data', {})
        languages_str = game_data.get('supported_languages', '')
        langs = [lang.strip() for lang in languages_str.replace('<strong>', '').replace('</strong>', '').split(',') if lang.strip()]
        return langs
    except Exception as e:
        print(f"Error fetching languages for appid {appid}: {e}")
        return []

def update_missing_languages():
    games = list(games_collection.find({}))
    for game in games:
        appid = game.get('appid')
        if not appid:
            continue
        meta = game.get('metadata', {})
        if not meta.get('supported_languages'):
            langs = fetch_supported_languages(appid)
            if langs:
                games_collection.update_one({'appid': appid}, {'$set': {'metadata.supported_languages': langs}})
                print(f"Updated appid {appid} with languages: {langs}")
            time.sleep(SLEEP_BETWEEN_GAMES)

def main():
    while True:
        print("Starting supported_languages update run...")
        update_missing_languages()
        print(f"Sleeping for {SLEEP_BETWEEN_RUNS} seconds before next run...")
        time.sleep(SLEEP_BETWEEN_RUNS)

if __name__ == "__main__":
    main()
