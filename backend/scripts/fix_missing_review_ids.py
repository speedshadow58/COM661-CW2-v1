# Script to add missing _id fields to reviews in all games
from pymongo import MongoClient
from bson import ObjectId

# Adjust connection string as needed
client = MongoClient('mongodb://localhost:27017/')
db = client['steam']  # Change to your DB name if different
games = db.steamGames

count = 0
for game in games.find({"reviews.list": {"$exists": True, "$ne": []}}):
    reviews = game['reviews']['list']
    updated = False
    for review in reviews:
        if ('_id' not in review) or (not review['_id']) or (str(review['_id']).strip() in ('', 'None', 'null')):
            review['_id'] = ObjectId()
            updated = True
            count += 1
    if updated:
        games.update_one({'_id': game['_id']}, {'$set': {'reviews.list': reviews}})

print(f"Added _id to {count} reviews.")
