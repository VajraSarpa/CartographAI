import fastapi

router = fastapi.APIRouter(prefix="/items")

@router.get("/")
def list_items():
    return []

@router.api_route("/{item_id}", methods=["GET", "POST"])
def item(item_id: int):
    return item_id

@router.delete(f"/{1}")
def computed():
    return None
