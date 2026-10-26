from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services import ai_service

router = APIRouter()


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: List[ChatMessage]
    page: Optional[str] = ""


@router.get("/ai/status")
async def ai_status():
    """Lets the UI know whether the assistant is ready to use."""
    return ai_service.status()


@router.post("/ai/chat")
async def ai_chat(body: ChatRequest) -> Dict[str, Any]:
    messages = [
        {"role": m.role, "content": m.content}
        for m in body.messages
        if m.role in ("user", "assistant") and m.content.strip()
    ]
    if not messages:
        raise HTTPException(status_code=400, detail="No message provided")

    try:
        return await ai_service.chat(messages, page=body.page or "")
    except ai_service.AIError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.detail)
