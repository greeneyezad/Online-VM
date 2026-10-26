from fastapi import APIRouter

from services import qemu_service

router = APIRouter()


@router.get("/system")
async def system_info():
    """Host capabilities, used by the UI to offer only usable VM options."""
    return qemu_service.capabilities()
