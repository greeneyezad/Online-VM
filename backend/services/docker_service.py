"""Client for the Docker Engine API over its Unix socket.

The host's Docker daemon is mounted into the API container at
``/var/run/docker.sock``, so no docker CLI is needed: the Engine speaks plain
HTTP over that socket, which httpx supports natively (``HTTPTransport(uds=…)``).
Every function degrades to a readable error when the socket is not mounted, so
the rest of the app is unaffected on hosts without Docker.
"""

import os
import re
from typing import Any, Dict, List, Optional

import httpx

SOCKET_PATH = os.environ.get("DOCKER_SOCKET", "/var/run/docker.sock")

# Container ids/names are passed straight into API paths, so keep them to the
# characters Docker itself accepts.
_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$")

_ACTIONS = ("start", "stop", "restart")

_api_version: Optional[str] = None


class DockerError(RuntimeError):
    """The Docker daemon rejected a request or could not be reached."""


def available() -> bool:
    """True when a Docker socket is mounted into this container."""
    return os.path.exists(SOCKET_PATH)


def valid_id(container_id: str) -> bool:
    return bool(container_id and _ID_PATTERN.match(container_id))


def valid_action(action: str) -> bool:
    return action in _ACTIONS


def human_size(size_bytes: float) -> str:
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if size_bytes < 1024:
            return f"{size_bytes:.1f} {unit}"
        size_bytes /= 1024
    return f"{size_bytes:.1f} PB"


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=httpx.AsyncHTTPTransport(uds=SOCKET_PATH),
        base_url="http://docker",
        timeout=httpx.Timeout(30.0, connect=5.0),
    )


async def _prefix(client: httpx.AsyncClient) -> str:
    """API version prefix, negotiated once from /version."""
    global _api_version
    if _api_version is None:
        resp = await client.get("/version")
        resp.raise_for_status()
        _api_version = resp.json().get("ApiVersion", "")
    return f"/v{_api_version}" if _api_version else ""


async def _request(method: str, path: str, params: Optional[dict] = None) -> httpx.Response:
    if not available():
        raise DockerError(
            "Docker is not available: mount /var/run/docker.sock into the API "
            "container to manage host containers."
        )
    try:
        async with _client() as client:
            api = await _prefix(client)
            resp = await client.request(method, api + path, params=params)
    except httpx.HTTPError as exc:
        raise DockerError(f"Cannot reach the Docker daemon: {exc}") from exc

    if resp.status_code >= 400:
        try:
            detail = resp.json().get("message")
        except ValueError:
            detail = resp.text
        raise DockerError(detail or f"Docker API error {resp.status_code}")
    return resp


async def _json(method: str, path: str, params: Optional[dict] = None) -> Any:
    return (await _request(method, path, params)).json()


# ──────────────────────────────────────────────
# Engine status
# ──────────────────────────────────────────────

async def status() -> Dict[str, Any]:
    """Engine version + container/image counts, or a readable unavailable state."""
    if not available():
        return {
            "available": False,
            "socket": SOCKET_PATH,
            "error": "Docker socket not mounted",
        }
    try:
        info = await _json("GET", "/info")
        version = await _json("GET", "/version")
    except DockerError as exc:
        return {"available": False, "socket": SOCKET_PATH, "error": str(exc)}

    return {
        "available": True,
        "socket": SOCKET_PATH,
        "version": version.get("Version"),
        "api_version": version.get("ApiVersion"),
        "os": info.get("OperatingSystem"),
        "architecture": info.get("Architecture"),
        "containers": info.get("Containers", 0),
        "containers_running": info.get("ContainersRunning", 0),
        "containers_paused": info.get("ContainersPaused", 0),
        "containers_stopped": info.get("ContainersStopped", 0),
        "images": info.get("Images", 0),
        "cpus": info.get("NCPU"),
        "memory_total": info.get("MemTotal", 0),
    }


# ──────────────────────────────────────────────
# Containers
# ──────────────────────────────────────────────

def _ports(entries: List[dict]) -> str:
    rendered = []
    for p in entries:
        if p.get("PublicPort"):
            rendered.append(
                f"{p.get('IP', '0.0.0.0')}:{p['PublicPort']}\u2192{p.get('PrivatePort')}/{p.get('Type')}"
            )
        else:
            rendered.append(f"{p.get('PrivatePort')}/{p.get('Type')}")
    return ", ".join(rendered)


async def list_containers() -> List[Dict[str, Any]]:
    raw = await _json("GET", "/containers/json", {"all": "true"})
    containers = []
    for c in raw:
        labels = c.get("Labels") or {}
        containers.append({
            "id": c.get("Id", ""),
            "short_id": (c.get("Id") or "")[:12],
            "name": (c.get("Names") or ["/unknown"])[0].lstrip("/"),
            "image": c.get("Image", ""),
            "state": c.get("State", ""),
            "status": c.get("Status", ""),
            "created": c.get("Created", 0),
            "ports": _ports(c.get("Ports") or []),
            "compose_project": labels.get("com.docker.compose.project"),
            "compose_service": labels.get("com.docker.compose.service"),
        })
    containers.sort(key=lambda c: (c["state"] != "running", c["name"]))
    return containers


async def container_logs(container_id: str, tail: int = 200) -> str:
    resp = await _request(
        "GET",
        f"/containers/{container_id}/logs",
        {"stdout": "1", "stderr": "1", "tail": str(tail)},
    )
    return _demux(resp.content)


async def container_action(container_id: str, action: str) -> None:
    params = {"t": "10"} if action in ("stop", "restart") else None
    await _request("POST", f"/containers/{container_id}/{action}", params)


def _demux(raw: bytes) -> str:
    """Strip Docker's 8-byte frame headers from a non-TTY log stream."""
    chunks = []
    offset = 0
    while offset + 8 <= len(raw):
        stream = raw[offset]
        size = int.from_bytes(raw[offset + 4:offset + 8], "big")
        body = raw[offset + 8:offset + 8 + size]
        if stream not in (0, 1, 2) or len(body) != size:
            return raw.decode(errors="replace")
        chunks.append(body)
        offset += 8 + size
    if chunks:
        return b"".join(chunks).decode(errors="replace")
    return raw.decode(errors="replace")


# ──────────────────────────────────────────────
# Images
# ──────────────────────────────────────────────

async def list_images() -> List[Dict[str, Any]]:
    raw = await _json("GET", "/images/json")
    images = []
    for i in raw:
        images.append({
            "id": i.get("Id", ""),
            "short_id": (i.get("Id") or "").replace("sha256:", "")[:12],
            "tags": i.get("RepoTags") or [],
            "size": i.get("Size", 0),
            "size_human": human_size(i.get("Size", 0)),
            "created": i.get("Created", 0),
        })
    images.sort(key=lambda i: i["created"], reverse=True)
    return images
