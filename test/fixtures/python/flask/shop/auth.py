from flask import Blueprint

bp = Blueprint("auth", __name__, url_prefix="/auth/")

@bp.route("/login", methods=("GET", "POST"))
def login():
    return "login"

@bp.post("/logout")
def logout():
    return "bye"
