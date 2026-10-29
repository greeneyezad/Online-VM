from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Re-attach to guests that outlived the previous worker.

    A reloaded worker starts with an empty in-memory registry, so every guest
    started before the reload looked stopped. Re-adopt the QEMU processes that
    are still alive, and clear "running"/"paused" on VMs whose process is gone.
    """
    from models.vm import VMConfig
    from services import qemu_service as qemu
    from services import vm_config as store

    vms = [VMConfig(**data) for data in (await store.load_vms()).values()]
    qemu.adopt_running(vms)
    for vm in vms:
        running = qemu.is_running(vm.id)
        if running and vm.status != "running":
            vm.status = "running"
            await store.save_vm(vm)
        elif not running and vm.status in ("running", "paused"):
            vm.status = "stopped"
            await store.save_vm(vm)
    yield


app = FastAPI(title="Online VM", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from routers import vms, isos, kernels, websocket, system, ai, docker, vm_transfer
app.include_router(vms.router, prefix="/api")
app.include_router(vm_transfer.router, prefix="/api")
app.include_router(isos.router, prefix="/api")
app.include_router(kernels.router, prefix="/api")
app.include_router(system.router, prefix="/api")
app.include_router(ai.router, prefix="/api")
app.include_router(docker.router, prefix="/api")
app.include_router(websocket.router)


@app.get("/health")
async def health():
    return {"status": "ok"}


# Serve frontend static files in production
frontend_dist = "/app/frontend/dist"
if os.path.exists(frontend_dist):
    app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="static")
