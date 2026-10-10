from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse

from services import vm_config as store
from services import vnc_proxy

router = APIRouter()


@router.websocket("/ws/vnc/{vm_id}")
async def vnc_websocket(websocket: WebSocket, vm_id: str):
    """Proxy WebSocket connections through to the VM's VNC server."""
    vm = await store.get_vm(vm_id)
    if not vm:
        # We can't send a proper 404 over WebSocket before accept,
        # so accept then close with an error code.
        await websocket.accept()
        await websocket.close(code=4004, reason="VM not found")
        return

    try:
        await vnc_proxy.proxy_websocket(websocket, "127.0.0.1", vm.vnc_port)
    except WebSocketDisconnect:
        pass
    except Exception:
        try:
            await websocket.close(code=1011)
        except Exception:
            pass
