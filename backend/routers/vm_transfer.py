"""VM import/export.

An export is a gzipped tar stream containing ``manifest.json`` (the VM config)
and, optionally, the disk image. A VM must be stopped to export it, so the
disk is consistent. Import builds a *new* VM from the archive: fresh id, no
runtime state, and only references to ISOs/kernels that exist on this host.
"""

import asyncio
import json
import os
import re
import shutil
import tarfile
import tempfile
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

import aiofiles
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

from models.vm import VMConfig
from services import qemu_service as qemu
from services import vm_config as store
from services.vm_config import DISKS_DIR, ISOS_DIR, KERNELS_DIR

EXPORTS_DIR = "/data/exports"
IMPORTS_DIR = "/data/imports"

os.makedirs(EXPORTS_DIR, exist_ok=True)
os.makedirs(IMPORTS_DIR, exist_ok=True)

FORMAT_NAME = "online-vm-export"
FORMAT_VERSION = 1

router = APIRouter()


def _slug(text: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9._-]+", "-", (text or "").strip()).strip("-")
    return slug[:60] or "vm"


def _unique_name(base: str, existing: List[str]) -> str:
    base = (base or "Imported VM").strip() or "Imported VM"
    taken = {n.lower() for n in existing}
    if base.lower() not in taken:
        return base
    for n in range(2, 1000):
        candidate = f"{base} ({n})"
        if candidate.lower() not in taken:
            return candidate
    return f"{base} ({uuid.uuid4().hex[:6]})"


def _local_reference(path: Optional[str], directory: str) -> Optional[str]:
    """Keep a reference only if the file actually exists on this host."""
    if not path:
        return None
    candidate = os.path.join(directory, os.path.basename(path))
    return candidate if os.path.exists(candidate) else None


def _manifest(vm: VMConfig, disk_name: Optional[str], disk_format: str) -> Dict[str, Any]:
    data = json.loads(vm.model_dump_json())
    # Runtime state belongs to the host, not the archive.
    data.pop("vnc_port", None)
    return {
        "format": FORMAT_NAME,
        "version": FORMAT_VERSION,
        "exported_at": datetime.utcnow().isoformat() + "Z",
        "source": {"app": "Online VM", "vm_id": vm.id},
        "disk": {"file": disk_name, "format": disk_format} if disk_name else None,
        "vm": data,
    }


# ──────────────────────────────────────────────
# Export
# ──────────────────────────────────────────────

async def _stream_archive(directory: str, files: List[str]):
    """tar -czf - written straight to the response, so no copy of the disk is made."""
    proc = await asyncio.create_subprocess_exec(
        # -h dereferences the disk symlink so the archive carries the image.
        "tar", "-czhf", "-", "-C", directory, *files,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        while True:
            chunk = await proc.stdout.read(256 * 1024)
            if not chunk:
                break
            yield chunk
        await proc.wait()
    finally:
        if proc.returncode is None:
            proc.kill()
            await proc.wait()
        shutil.rmtree(directory, ignore_errors=True)


@router.get("/vms/{vm_id}/export")
async def export_vm(vm_id: str, include_disk: bool = True):
    vm = await store.get_vm(vm_id)
    if not vm:
        raise HTTPException(status_code=404, detail="VM not found")
    if qemu.is_running(vm_id):
        raise HTTPException(status_code=400, detail="Stop the VM before exporting it")

    disk_name = None
    if include_disk and vm.disk_path and os.path.exists(vm.disk_path):
        disk_name = f"disk.{vm.disk_format or 'qcow2'}"

    directory = tempfile.mkdtemp(prefix=f"{_slug(vm.name)}-", dir=EXPORTS_DIR)
    files = ["manifest.json"]
    try:
        manifest_path = os.path.join(directory, "manifest.json")
        async with aiofiles.open(manifest_path, "w") as f:
            await f.write(json.dumps(_manifest(vm, disk_name, vm.disk_format or "qcow2"), indent=2))
        if disk_name:
            os.symlink(os.path.abspath(vm.disk_path), os.path.join(directory, disk_name))
            files.append(disk_name)
    except Exception as exc:
        shutil.rmtree(directory, ignore_errors=True)
        raise HTTPException(status_code=500, detail=f"Export failed: {exc}")

    filename = f"{_slug(vm.name)}-{vm.id[:8]}.tar.gz"
    return StreamingResponse(
        _stream_archive(directory, files),
        media_type="application/gzip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ──────────────────────────────────────────────
# Import
# ──────────────────────────────────────────────

def _extract_archive(archive_path: str, new_id: str, existing_names: List[str],
                     requested_name: Optional[str]) -> VMConfig:
    """Read the manifest and stream the disk out of the archive (runs in a thread)."""
    try:
        tf = tarfile.open(archive_path, "r:gz")
    except tarfile.TarError as exc:
        raise ValueError(f"Not a valid .tar.gz archive: {exc}")

    with tf:
        try:
            manifest_member = tf.getmember("manifest.json")
        except KeyError:
            raise ValueError("Not a Online VM export: manifest.json is missing")
        with tf.extractfile(manifest_member) as fh:
            manifest = json.loads(fh.read().decode("utf-8", errors="replace"))

        if manifest.get("format") != FORMAT_NAME:
            raise ValueError("Unsupported archive: not a Online VM export")

        raw: Dict[str, Any] = manifest.get("vm") or {}
        disk_info = manifest.get("disk") or {}
        disk_format = (disk_info.get("format") or raw.get("disk_format") or "qcow2").lower()
        if disk_format not in ("qcow2", "raw"):
            disk_format = "qcow2"

        disk_path = os.path.join(DISKS_DIR, f"{new_id}.{disk_format}")
        disk_name = disk_info.get("file")
        if disk_name:
            if os.path.basename(disk_name) != disk_name:
                raise ValueError("Archive contains an unsafe disk path")
            try:
                disk_member = tf.getmember(disk_name)
            except KeyError:
                raise ValueError("Archive is missing its disk image")
            with tf.extractfile(disk_member) as src, open(disk_path, "wb") as out:
                shutil.copyfileobj(src, out, 8 * 1024 * 1024)

    allowed = set(VMConfig.model_fields)
    vm = VMConfig(**{k: v for k, v in raw.items() if k in allowed})
    vm.id = new_id
    vm.name = _unique_name(requested_name or raw.get("name") or "Imported VM", existing_names)
    vm.status = "stopped"
    vm.vnc_port = 5900
    vm.disk_path = disk_path
    vm.disk_format = disk_format
    vm.iso_path = _local_reference(vm.iso_path, ISOS_DIR)
    vm.kernel_path = _local_reference(vm.kernel_path, KERNELS_DIR)
    vm.initrd_path = _local_reference(vm.initrd_path, KERNELS_DIR)
    return vm


@router.post("/vms/import", status_code=201)
async def import_vm(file: UploadFile = File(...), name: Optional[str] = Form(None)):
    if not file.filename:
        raise HTTPException(status_code=400, detail="No archive uploaded")

    existing = await store.load_vms()
    existing_names = [v.get("name", "") for v in existing.values()]
    new_id = str(uuid.uuid4())
    archive_path = os.path.join(IMPORTS_DIR, f"{new_id}.tar.gz")

    try:
        async with aiofiles.open(archive_path, "wb") as out:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                await out.write(chunk)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Upload failed: {exc}")

    try:
        vm = await asyncio.to_thread(
            _extract_archive, archive_path, new_id, existing_names, name
        )
    except ValueError as exc:
        _discard(new_id, archive_path)
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        _discard(new_id, archive_path)
        raise HTTPException(status_code=500, detail=f"Import failed: {exc}")
    finally:
        try:
            os.remove(archive_path)
        except OSError:
            pass

    await store.save_vm(vm)
    return vm


def _discard(new_id: str, archive_path: str) -> None:
    """Remove the partial upload and any half-written disk after a failed import."""
    try:
        os.remove(archive_path)
    except OSError:
        pass
    for name in os.listdir(DISKS_DIR):
        if name.startswith(new_id):
            try:
                os.remove(os.path.join(DISKS_DIR, name))
            except OSError:
                pass
