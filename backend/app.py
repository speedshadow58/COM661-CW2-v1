from flask import Flask
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

# Import routes after creating the app
from routes.games import games_bp
from routes.reviews import reviews_bp
from routes.developers import developers_bp
from routes.misc import misc_bp
from routes.advanced import advanced_bp
from routes.auth import auth_bp
from routes.steam_proxy import steam_proxy_bp


# Register blueprints
app.register_blueprint(games_bp)
app.register_blueprint(reviews_bp)
app.register_blueprint(developers_bp)
app.register_blueprint(misc_bp)
app.register_blueprint(advanced_bp)
app.register_blueprint(auth_bp)
app.register_blueprint(steam_proxy_bp)

if __name__ == "__main__":
    app.run(debug=True)
