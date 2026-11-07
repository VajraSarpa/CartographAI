from fastapi import APIRouter

never_included = APIRouter(prefix="/lost")
dynamic_router = APIRouter()

@never_included.get("/a")
def a():
    return 1

@dynamic_router.get("/b")
def b():
    return 2
