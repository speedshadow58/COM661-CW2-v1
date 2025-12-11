import requests
from pymongo import MongoClient
from time import sleep

# --- CONFIG ---
MONGO_URI = 'mongodb://localhost:27017/'
DB_NAME = 'steam'
COLLECTION = 'steamGames'

# --- STEAM API ---
STEAM_API_URL = 'https://store.steampowered.com/api/appdetails?appids={appid}&cc=gb&l=en'

# --- SCRIPT ---
def fetch_gbp_price(appid):
    try:
        url = STEAM_API_URL.format(appid=appid)
        resp = requests.get(url, timeout=5)
        data = resp.json()
        entry = data.get(str(appid), None)
        if not entry or not entry.get('success'):
            print(f"[Missing] appid {appid}: No data from Steam API.")
            return None
        price_info = entry['data'].get('price_overview')
        if price_info and price_info.get('currency') == 'GBP':
            return price_info['final'] / 100.0
        elif price_info and price_info.get('final'):
            return price_info['final'] / 100.0
        else:
            print(f"[Missing] appid {appid}: No price info available.")
    except Exception as e:
        print(f"[Error] appid {appid}: {e}")
    return None

def update_all_prices():
    client = MongoClient(MONGO_URI)
    db = client[DB_NAME]
    games = db[COLLECTION]
    
    all_games = list(games.find({}, {'appid': 1}))
    print(f"Found {len(all_games)} games.")
    updated = 0
    for g in all_games:
        appid = g.get('appid')
        if not appid:
            continue
        price = fetch_gbp_price(appid)
        if price is not None:
            result = games.update_one({'appid': appid}, {'$set': {'metadata.price': price}})
            if result.modified_count:
                print(f"Updated appid {appid} to £{price}")
                updated += 1
        sleep(0.5)  # avoid hammering Steam API
    print(f"Done. Updated {updated} games.")

if __name__ == '__main__':
    update_all_prices()
