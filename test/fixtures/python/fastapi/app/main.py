from fastapi import FastAPI
from app.api import api_router
from app.routers import orphan
from app import settings

app = FastAPI()
app.include_router(api_router, prefix="/api")
app.include_router(orphan.dynamic_router, prefix=settings.PREFIX)

@app.get("/health")
def health():
    return "ok"
