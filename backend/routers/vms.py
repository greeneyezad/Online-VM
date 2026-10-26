import uuid
from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from models.vm import VMConfig, VMCreate, VMUpdate, Snapshot
from services import vm_config as store
from services import qemu_service as qemu

router = APIRouter()


def _check_ram(ram_mb: int) -> None:
    """Reject RAM the host cannot actually allocate (QEMU would fail on start)."""
    limit = qemu.max_ram_mb()
    if ram_mb > limit:
        raise HTTPException(
            status_code=400,
            detail=f"RAM {ram_mb} MB exceeds this host's limit of {limit} MB "
                   f"({qemu.host_ram_mb()} MB total).",
        )


# ──────────────────────────────────────────────
# VM CRUD
# ──────────────────────────────────────────────

@router.get("/vms")
async def list_vms():
    vms = await store.load_vms()
    return list(vms.values())


@router.post("/vms", status_code=201)
async def create_vm(body: VMCreate):
    _check_ram(body.ram_mb)
    vm_id = str(uuid.uuid4())
    disk_path = f"{store.DISKS_DIR}/{vm_id}.{body.disk_format}"

    vm = VMConfig(
        id=vm_id,
        disk_path=disk_path,
        **body.model_dump(),
    )
    await store.save_vm(vm)
    return vm


@router.get("/vms/{vm_id}")
async def get_vm(vm_id: str):
    vm = await store.get_vm(vm_id)
    if not vm:
        raise HTTPException(status_code=404, detail="VM not found")
    return vm


@router.put("/vms/{vm_id}")
async def update_vm(vm_id: str, body: VMUpdate):
    vm = await store.get_vm(vm_id)
    if not vm:
        raise HTTPException(status_code=404, detail="VM not found")
    if vm.status == "running":
        raise HTTPException(status_code=400, detail="Stop the VM before changing settings")

    update_data = body.model_dump(exclude_unset=True)
    if "ram_mb" in update_data:
        _check_ram(update_data["ram_mb"])
    for key, value in update_data.items():
        setattr(vm, key, value)

    await store.save_vm(vm)
    return vm


@router.delete("/vms/{vm_id}")
async def delete_vm(vm_id: str):
    vm = await store.get_vm(vm_id)
    if not vm:
        raise HTTPException(status_code=404, detail="VM not found")
    if vm.status == "running":
        raise HTTPException(status_code=400, detail="Stop the VM before deleting")

    await store.delete_vm(vm_id)
    return {"detail": "VM deleted"}


# ──────────────────────────────────────────────
# VM Lifecycle
# ──────────────────────────────────────────────

@router.post("/vms/{vm_id}/start")
async def start_vm(vm_id: str):
    vm = await store.get_vm(vm_id)
    if not vm:
        raise HTTPException(status_code=404, detail="VM not found")
    if qemu.is_running(vm_id):
        raise HTTPException(status_code=400, detail="VM is already running")

    try:
        await qemu.start_vm(vm)
        vm.status = "running"
        vm.vnc_port = qemu.running_vms[vm_id]["vnc_port"]
        await store.save_vm(vm)
    except Exception as exc:
        vm.status = "error"
        await store.save_vm(vm)
        raise HTTPException(status_code=500, detail=str(exc))

    return {"detail": "VM started", "vnc_port": vm.vnc_port}


@router.post("/vms/{vm_id}/stop")
async def stop_vm(vm_id: str):
    vm = await store.get_vm(vm_id)
    if not vm:
        raise HTTPException(status_code=404, detail="VM not found")

    try:
        await qemu.stop_vm(vm_id)
        vm.status = "stopped"
        await store.save_vm(vm)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    return {"detail": "Stop signal sent"}


@router.post("/vms/{vm_id}/force-stop")
async def force_stop_vm(vm_id: str):
    vm = await store.get_vm(vm_id)
    if not vm:
        raise HTTPException(status_code=404, detail="VM not found")

    try:
        await qemu.force_stop_vm(vm_id)
        vm.status = "stopped"
        await store.save_vm(vm)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    return {"detail": "VM force-stopped"}


@router.post("/vms/{vm_id}/pause")
async def pause_vm(vm_id: str):
    vm = await store.get_vm(vm_id)
    if not vm:
        raise HTTPException(status_code=404, detail="VM not found")
    if not qemu.is_running(vm_id):
        raise HTTPException(status_code=400, detail="VM is not running")

    try:
        await qemu.pause_vm(vm_id)
        vm.status = "paused"
        await store.save_vm(vm)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    return {"detail": "VM paused"}


@router.post("/vms/{vm_id}/resume")
async def resume_vm(vm_id: str):
    vm = await store.get_vm(vm_id)
    if not vm:
        raise HTTPException(status_code=404, detail="VM not found")

    try:
        await qemu.resume_vm(vm_id)
        vm.status = "running"
        await store.save_vm(vm)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    return {"detail": "VM resumed"}


@router.post("/vms/{vm_id}/reset")
async def reset_vm(vm_id: str):
    vm = await store.get_vm(vm_id)
    if not vm:
        raise HTTPException(status_code=404, detail="VM not found")
    if not qemu.is_running(vm_id):
        raise HTTPException(status_code=400, detail="VM is not running")

    try:
        await qemu.reset_vm(vm_id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    return {"detail": "VM reset"}


@router.get("/vms/{vm_id}/status")
async def get_vm_status(vm_id: str):
    vm = await store.get_vm(vm_id)
    if not vm:
        raise HTTPException(status_code=404, detail="VM not found")

    is_running = qemu.is_running(vm_id)
    # Reconcile stored status with actual process state
    if not is_running and vm.status == "running":
        vm.status = "stopped"
        await store.save_vm(vm)

    return {"id": vm_id, "status": vm.status, "is_running": is_running}


# ──────────────────────────────────────────────
# Snapshots
# ──────────────────────────────────────────────

class SnapshotCreate(BaseModel):
    name: str
    description: str = ""


@router.post("/vms/{vm_id}/snapshot", status_code=201)
async def create_snapshot(vm_id: str, body: SnapshotCreate):
    vm = await store.get_vm(vm_id)
    if not vm:
        raise HTTPException(status_code=404, detail="VM not found")
    if not qemu.is_running(vm_id):
        raise HTTPException(status_code=400, detail="VM must be running to take a snapshot")

    snapshot = Snapshot(name=body.name, description=body.description)

    try:
        await qemu.send_monitor_command(vm_id, f"savevm {snapshot.id}")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    vm.snapshots.append(snapshot)
    await store.save_vm(vm)
    return snapshot


@router.get("/vms/{vm_id}/snapshots")
async def list_snapshots(vm_id: str):
    vm = await store.get_vm(vm_id)
    if not vm:
        raise HTTPException(status_code=404, detail="VM not found")
    return vm.snapshots


@router.post("/vms/{vm_id}/snapshot/{snapshot_id}/restore")
async def restore_snapshot(vm_id: str, snapshot_id: str):
    vm = await store.get_vm(vm_id)
    if not vm:
        raise HTTPException(status_code=404, detail="VM not found")

    snap = next((s for s in vm.snapshots if s.id == snapshot_id), None)
    if not snap:
        raise HTTPException(status_code=404, detail="Snapshot not found")

    try:
        await qemu.send_monitor_command(vm_id, f"loadvm {snapshot_id}")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    return {"detail": f"Snapshot '{snap.name}' restored"}


@router.delete("/vms/{vm_id}/snapshot/{snapshot_id}")
async def delete_snapshot(vm_id: str, snapshot_id: str):
    vm = await store.get_vm(vm_id)
    if not vm:
        raise HTTPException(status_code=404, detail="VM not found")

    snap = next((s for s in vm.snapshots if s.id == snapshot_id), None)
    if not snap:
        raise HTTPException(status_code=404, detail="Snapshot not found")

    try:
        await qemu.send_monitor_command(vm_id, f"delvm {snapshot_id}")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    vm.snapshots = [s for s in vm.snapshots if s.id != snapshot_id]
    await store.save_vm(vm)
    return {"detail": f"Snapshot '{snap.name}' deleted"}
