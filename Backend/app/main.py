from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .firebase import init_firebase
from .routes import auth, users


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_firebase()
    yield


app = FastAPI(title="PlugOrbit API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(users.router)


@app.get("/health", tags=["health"])
def health():
    return {"status": "ok"}
