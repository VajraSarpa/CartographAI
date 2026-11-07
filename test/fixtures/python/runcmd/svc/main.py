from fastapi import FastAPI
from svc.api import router

app = FastAPI()
app.include_router(router, prefix="/v1")
