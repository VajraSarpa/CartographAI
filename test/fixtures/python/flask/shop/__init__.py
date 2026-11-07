from flask import Flask
from . import auth, admin

def create_app():
    app = Flask(__name__)
    app.register_blueprint(auth.bp)
    app.register_blueprint(admin.bp, url_prefix="/staff")

    @app.route("/")
    def index():
        return "home"

    return app
