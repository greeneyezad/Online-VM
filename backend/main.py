from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os

app = FastAPI(title="Online VM", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from routers import vms, isos, websocket, system, ai
app.include_router(vms.router, prefix="/api")
app.include_router(isos.router, prefix="/api")
app.include_router(system.router, prefix="/api")
app.include_router(ai.router, prefix="/api")
app.include_router(websocket.router)


@app.get("/health")
async def health():
    return {"status": "ok"}


# Serve frontend static files in production
frontend_dist = "/app/frontend/dist"
if os.path.exists(frontend_dist):
    app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="static")
