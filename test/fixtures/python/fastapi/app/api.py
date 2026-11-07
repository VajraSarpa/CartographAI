from fastapi import APIRouter
from app.routers import items

api_router = APIRouter()
api_router.include_router(items.router)
