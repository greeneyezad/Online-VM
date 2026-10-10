import os
import aiofiles
from fastapi import APIRouter, HTTPException, UploadFile, File

from services.vm_config import ISOS_DIR

router = APIRouter()


def _human_size(size_bytes: int) -> str:
    """Convert bytes to a human-readable string."""
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if size_bytes < 1024:
            return f"{size_bytes:.1f} {unit}"
        size_bytes /= 1024
    return f"{size_bytes:.1f} PB"


@router.get("/isos")
async def list_isos():
    """Return a list of ISO files available in the ISO directory."""
    if not os.path.exists(ISOS_DIR):
        return []

    results = []
    for filename in os.listdir(ISOS_DIR):
        if not filename.lower().endswith(".iso"):
            continue
        path = os.path.join(ISOS_DIR, filename)
        size = os.path.getsize(path)
        results.append({
            "name": filename,
            "size": size,
            "path": path,
            "size_human": _human_size(size),
        })

    results.sort(key=lambda x: x["name"])
    return results


@router.post("/isos/upload", status_code=201)
async def upload_iso(file: UploadFile = File(...)):
    """Accept an ISO file upload and save it to the ISO directory."""
    if not file.filename or not file.filename.lower().endswith(".iso"):
        raise HTTPException(status_code=400, detail="Only .iso files are accepted")

    dest_path = os.path.join(ISOS_DIR, file.filename)

    try:
        async with aiofiles.open(dest_path, "wb") as out:
            while True:
                chunk = await file.read(1024 * 1024)  # 1 MB chunks
                if not chunk:
                    break
                await out.write(chunk)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Upload failed: {exc}")

    size = os.path.getsize(dest_path)
    return {
        "name": file.filename,
        "size": size,
        "path": dest_path,
        "size_human": _human_size(size),
    }


@router.delete("/isos/{filename}")
async def delete_iso(filename: str):
    """Delete an ISO file by name."""
    # Prevent directory traversal
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")

    path = os.path.join(ISOS_DIR, filename)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="ISO not found")

    try:
        os.remove(path)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Delete failed: {exc}")

    return {"detail": f"{filename} deleted"}
