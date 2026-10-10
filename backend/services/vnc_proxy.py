import asyncio
from fastapi import WebSocket, WebSocketDisconnect


async def proxy_websocket(websocket: WebSocket, vnc_host: str, vnc_port: int) -> None:
    """
    Proxy a WebSocket connection to a raw TCP VNC server.

    Opens the WebSocket, connects to the VNC server over TCP, then
    runs two concurrent relay tasks (ws->tcp and tcp->ws) until either
    side disconnects.
    """
    await websocket.accept()

    try:
        reader, writer = await asyncio.open_connection(vnc_host, vnc_port)
    except Exception as exc:
        await websocket.close(code=1011, reason=f"Could not connect to VNC: {exc}")
        return

    async def ws_to_tcp():
        try:
            while True:
                data = await websocket.receive_bytes()
                writer.write(data)
                await writer.drain()
        except (WebSocketDisconnect, Exception):
            pass

    async def tcp_to_ws():
        try:
            while True:
                data = await asyncio.wait_for(reader.read(4096), timeout=60.0)
                if not data:
                    break
                await websocket.send_bytes(data)
        except (asyncio.TimeoutError, asyncio.CancelledError, Exception):
            pass

    tasks = [
        asyncio.create_task(ws_to_tcp()),
        asyncio.create_task(tcp_to_ws()),
    ]

    # Wait until either relay task finishes
    done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)

    # Cancel the remaining task
    for task in pending:
        task.cancel()
        try:
            await task
        except (asyncio.CancelledError, Exception):
            pass

    # Close the TCP connection
    try:
        writer.close()
        await writer.wait_closed()
    except Exception:
        pass

    # Close the WebSocket if still open
    try:
        await websocket.close()
    except Exception:
        pass
