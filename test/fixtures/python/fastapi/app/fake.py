class FastAPI:
    def get(self, path):
        return lambda f: f

app = FastAPI()

@app.get("/not-a-route")
def nope():
    return None
