import socket
from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException

from services import docker_service as docker

router = APIRouter()


def _mark_protected(containers: List[Dict[str, Any]]) -> None:
    """Flag the containers that run Online VM itself.

    Stopping those would take the UI (or this API) down, so the UI disables
    their actions and the API refuses them. The API container's hostname is its
    Docker id, which is how the compose project is identified.
    """
    host = socket.gethostname()
    me = next((c for c in containers if host and c["id"].startswith(host)), None)
    project = me.get("compose_project") if me else None
    for c in containers:
        c["protected"] = bool(
            (me and c["id"] == me["id"])
            or (host and c["name"] == host)
            or (project and c.get("compose_project") == project)
        )


def _find(containers: List[Dict[str, Any]], container_id: str) -> Dict[str, Any]:
    match = next((c for c in containers if c["id"].startswith(container_id)), None)
    if not match:
        raise HTTPException(status_code=404, detail="Container not found")
    return match


@router.get("/docker/status")
async def docker_status():
    return await docker.status()


@router.get("/docker/containers")
async def docker_containers():
    try:
        containers = await docker.list_containers()
    except docker.DockerError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    _mark_protected(containers)
    return containers


@router.get("/docker/images")
async def docker_images():
    try:
        return await docker.list_images()
    except docker.DockerError as exc:
        raise HTTPException(status_code=503, detail=str(exc))


@router.post("/docker/containers/{container_id}/{action}")
async def docker_container_action(container_id: str, action: str):
    if not docker.valid_id(container_id):
        raise HTTPException(status_code=400, detail="Invalid container id")
    if not docker.valid_action(action):
        raise HTTPException(status_code=400, detail="Unsupported action")

    try:
        containers = await docker.list_containers()
        _mark_protected(containers)
        target = _find(containers, container_id)
        if target["protected"]:
            raise HTTPException(
                status_code=400,
                detail="This container runs Online VM itself and cannot be controlled from here",
            )
        await docker.container_action(container_id, action)
    except docker.DockerError as exc:
        raise HTTPException(status_code=503, detail=str(exc))

    return {"detail": f"Container {action} requested"}


@router.get("/docker/containers/{container_id}/logs")
async def docker_container_logs(container_id: str, tail: int = 200):
    if not docker.valid_id(container_id):
        raise HTTPException(status_code=400, detail="Invalid container id")
    try:
        logs = await docker.container_logs(container_id, tail=max(1, min(tail, 2000)))
    except docker.DockerError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    return {"logs": logs}
