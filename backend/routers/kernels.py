import os
from typing import Any, Dict, List

import aiofiles
from fastapi import APIRouter, File, HTTPException, UploadFile

from services.vm_config import KERNELS_DIR

router = APIRouter()


def _human_size(size_bytes: int) -> str:
    """Convert bytes to a human-readable string."""
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if size_bytes < 1024:
            return f"{size_bytes:.1f} {unit}"
        size_bytes /= 1024
    return f"{size_bytes:.1f} PB"


def _entry(filename: str) -> Dict[str, Any]:
    path = os.path.join(KERNELS_DIR, filename)
    size = os.path.getsize(path)
    lower = filename.lower()
    kind = "initrd" if ("initrd" in lower or "initramfs" in lower) else "kernel"
    return {
        "name": filename,
        "size": size,
        "size_human": _human_size(size),
        "path": path,
        "kind": kind,
    }


def _safe_name(filename: str) -> str:
    """Reject anything that could escape the kernel directory."""
    name = os.path.basename(filename or "").strip()
    if not name or name in (".", "..") or "/" in name or "\\" in name:
        raise HTTPException(status_code=400, detail="Invalid filename")
    return name


@router.get("/kernels")
async def list_kernels() -> List[Dict[str, Any]]:
    """Return the kernel/initrd images available for direct kernel boot."""
    if not os.path.exists(KERNELS_DIR):
        return []
    results = [
        _entry(name)
        for name in os.listdir(KERNELS_DIR)
        if os.path.isfile(os.path.join(KERNELS_DIR, name))
    ]
    results.sort(key=lambda x: x["name"])
    return results


@router.post("/kernels/upload", status_code=201)
async def upload_kernel(file: UploadFile = File(...)):
    """Accept a kernel (vmlinuz/bzImage) or initrd image.

    Kernel images carry no usable extension, so any file is accepted; the UI
    labels it as a kernel or an initrd based on the name.
    """
    name = _safe_name(file.filename or "")
    dest_path = os.path.join(KERNELS_DIR, name)

    try:
        async with aiofiles.open(dest_path, "wb") as out:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                await out.write(chunk)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Upload failed: {exc}")

    return _entry(name)


@router.delete("/kernels/{filename}")
async def delete_kernel(filename: str):
    name = _safe_name(filename)
    path = os.path.join(KERNELS_DIR, name)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Kernel image not found")

    try:
        os.remove(path)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Delete failed: {exc}")

    return {"detail": f"{name} deleted"}
