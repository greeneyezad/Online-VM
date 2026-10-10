import asyncio
import json
import os
import aiofiles
from typing import Optional
from models.vm import VMConfig

DATA_DIR = "/data"
VMS_FILE = "/data/vms.json"
DISKS_DIR = "/data/disks"
ISOS_DIR = "/data/isos"

# Create directories on import
os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(DISKS_DIR, exist_ok=True)
os.makedirs(ISOS_DIR, exist_ok=True)

_lock = asyncio.Lock()


async def load_vms() -> dict:
    """Load all VMs from the JSON store. Returns a dict keyed by vm id."""
    if not os.path.exists(VMS_FILE):
        return {}
    async with _lock:
        async with aiofiles.open(VMS_FILE, "r") as f:
            content = await f.read()
        if not content.strip():
            return {}
        return json.loads(content)


async def save_vms(vms: dict) -> None:
    """Persist the entire VM dict to disk."""
    async with _lock:
        async with aiofiles.open(VMS_FILE, "w") as f:
            await f.write(json.dumps(vms, default=str, indent=2))


async def get_vm(vm_id: str) -> Optional[VMConfig]:
    """Fetch a single VM by id. Returns None if not found."""
    vms = await load_vms()
    data = vms.get(vm_id)
    if data is None:
        return None
    return VMConfig(**data)


async def save_vm(vm: VMConfig) -> None:
    """Insert or update a single VM in the store."""
    vms = await load_vms()
    vms[vm.id] = json.loads(vm.model_dump_json())
    await save_vms(vms)


async def delete_vm(vm_id: str) -> None:
    """Remove a VM from the store by id."""
    vms = await load_vms()
    vms.pop(vm_id, None)
    await save_vms(vms)
