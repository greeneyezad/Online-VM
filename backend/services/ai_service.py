"""In-app AI assistant.

Talks to any OpenAI-compatible chat-completions endpoint and can inspect and
act on the hypervisor through function calling.

Configuration (environment):
  OPENAI_API_KEY   required; the assistant stays disabled without it
  OPENAI_BASE_URL  optional, default https://api.openai.com/v1
  OPENAI_MODEL     optional, default gpt-4o-mini
"""

import json
import os
from typing import Any, Dict, List

import httpx

from models.vm import VMConfig
from services import qemu_service as qemu
from services import vm_config as store

DEFAULT_BASE_URL = "https://api.openai.com/v1"
DEFAULT_MODEL = "gpt-4o-mini"
MAX_TOOL_ROUNDS = 5
REQUEST_TIMEOUT = 60.0

SYSTEM_PROMPT = """You are the built-in assistant inside "Online VM", a QEMU \
hypervisor manager. Your job is to help the user debug problems and fix them.

How to work:
- Inspect the live state with your tools before answering; never guess what a \
VM's status is.
- Explain the cause in one or two sentences, then give the smallest fix.
- You may start, stop, force-stop, pause, resume and reset VMs yourself when \
that is the fix. Say plainly what you changed.
- Never delete VMs, ISOs or snapshots and never touch disk images; tell the \
user to do that in the UI instead.
- Guests run under software emulation (TCG) when the host has no /dev/kvm, so \
boots and installers are slow. A black console right after start is normal.
- "No internet" in a guest usually means: the guest interface is down (in the \
guest run `ip link set eth0 up` then `udhcpc -i eth0`), or DHCP is still \
pending on a slow boot. Ask the user to check `ip a` inside the guest.
- Keep answers short: a sentence or two plus a short list. Plain text only, no \
tables."""

TOOLS: List[Dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "system_info",
            "description": "Host capabilities: accelerator (kvm/tcg), QEMU version, RAM, defaults.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_vms",
            "description": "All VMs with their status, resources, ISO and network settings.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_vm",
            "description": "Full configuration and live status of one VM.",
            "parameters": {
                "type": "object",
                "properties": {"vm_id": {"type": "string"}},
                "required": ["vm_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_isos",
            "description": "ISOs available in the library.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "start_vm",
            "description": "Boot a stopped VM.",
            "parameters": {
                "type": "object",
                "properties": {"vm_id": {"type": "string"}},
                "required": ["vm_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "stop_vm",
            "description": "Ask a VM to shut down gracefully.",
            "parameters": {
                "type": "object",
                "properties": {
                    "vm_id": {"type": "string"},
                    "force": {"type": "boolean", "description": "kill it instead of a graceful ACPI shutdown"},
                },
                "required": ["vm_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "reset_vm",
            "description": "Hard reset (reboot) a running VM.",
            "parameters": {
                "type": "object",
                "properties": {"vm_id": {"type": "string"}},
                "required": ["vm_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "set_vm_power",
            "description": "Pause or resume a VM.",
            "parameters": {
                "type": "object",
                "properties": {
                    "vm_id": {"type": "string"},
                    "action": {"type": "string", "enum": ["pause", "resume"]},
                },
                "required": ["vm_id", "action"],
            },
        },
    },
]


class AIError(Exception):
    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status = status
        self.detail = detail


def _env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip()


def api_key() -> str:
    return _env("OPENAI_API_KEY")


def base_url() -> str:
    return _env("OPENAI_BASE_URL", DEFAULT_BASE_URL).rstrip("/") or DEFAULT_BASE_URL


def model() -> str:
    return _env("OPENAI_MODEL", DEFAULT_MODEL) or DEFAULT_MODEL


def configured() -> bool:
    return bool(api_key())


def status() -> Dict[str, Any]:
    return {"configured": configured(), "model": model()}


# ──────────────────────────────────────────────
# Live state helpers
# ──────────────────────────────────────────────

def _iso_name(path: str) -> str:
    return os.path.basename(path) if path else ""


async def snapshot() -> Dict[str, Any]:
    """Everything the model needs to see the current state."""
    stored = await store.load_vms()
    vms = [VMConfig(**data) for data in stored.values()]
    isos_dir = store.ISOS_DIR
    try:
        isos = sorted(f for f in os.listdir(isos_dir) if f.lower().endswith(".iso"))
    except OSError:
        isos = []

    return {
        "host": qemu.capabilities(),
        "vms": [
            {
                "id": vm.id,
                "name": vm.name,
                "status": vm.status,
                "running": qemu.is_running(vm.id),
                "cpu_cores": vm.cpu_cores,
                "ram_mb": vm.ram_mb,
                "disk_size_gb": vm.disk_size_gb,
                "disk_bus": vm.disk_bus,
                "iso": _iso_name(vm.iso_path),
                "boot_order": vm.boot_order,
                "network_type": vm.network_type,
                "port_forwards": [pf.model_dump() if hasattr(pf, "model_dump") else pf for pf in (vm.port_forwards or [])],
                "vnc_port": vm.vnc_port,
                "last_error": getattr(vm, "error", None),
            }
            for vm in vms
        ],
        "isos": isos,
    }


async def _require_vm(vm_id: str):
    vm = await store.get_vm(vm_id)
    if not vm:
        raise AIError(404, f"VM {vm_id} does not exist")
    return vm


async def run_tool(name: str, args: Dict[str, Any]) -> Dict[str, Any]:
    """Execute one tool call. Returns a JSON-serialisable result."""
    if name == "system_info":
        return qemu.capabilities()

    if name == "list_vms":
        data = await snapshot()
        return {"vms": data["vms"]}

    if name == "list_isos":
        return {"isos": (await snapshot())["isos"]}

    if name == "get_vm":
        vm = await _require_vm(args.get("vm_id", ""))
        return {
            "vm": vm.model_dump(),
            "running": qemu.is_running(vm.id),
        }

    if name == "start_vm":
        vm = await _require_vm(args.get("vm_id", ""))
        if qemu.is_running(vm.id):
            return {"detail": "already running", "status": "running"}
        try:
            await qemu.start_vm(vm)
        except Exception as exc:  # surface the real QEMU error to the model
            vm.status = "error"
            await store.save_vm(vm)
            return {"error": str(exc)}
        vm.status = "running"
        vm.vnc_port = qemu.running_vms[vm.id]["vnc_port"]
        await store.save_vm(vm)
        return {"detail": "started", "status": "running", "vnc_port": vm.vnc_port}

    if name == "stop_vm":
        vm = await _require_vm(args.get("vm_id", ""))
        try:
            if args.get("force"):
                await qemu.force_stop_vm(vm.id)
            else:
                await qemu.stop_vm(vm.id)
        except Exception as exc:
            return {"error": str(exc)}
        vm.status = "stopped"
        await store.save_vm(vm)
        return {"detail": "stopped", "status": "stopped"}

    if name == "reset_vm":
        vm = await _require_vm(args.get("vm_id", ""))
        if not qemu.is_running(vm.id):
            return {"error": "VM is not running"}
        await qemu.reset_vm(vm.id)
        return {"detail": "reset"}

    if name == "set_vm_power":
        vm = await _require_vm(args.get("vm_id", ""))
        action = args.get("action")
        if action == "pause":
            if not qemu.is_running(vm.id):
                return {"error": "VM is not running"}
            await qemu.pause_vm(vm.id)
            vm.status = "paused"
        elif action == "resume":
            await qemu.resume_vm(vm.id)
            vm.status = "running"
        else:
            return {"error": f"unknown action {action}"}
        await store.save_vm(vm)
        return {"detail": action, "status": vm.status}

    return {"error": f"unknown tool {name}"}


# ──────────────────────────────────────────────
# Chat
# ──────────────────────────────────────────────

async def _complete(messages: List[Dict[str, Any]]) -> Dict[str, Any]:
    payload = {
        "model": model(),
        "messages": messages,
        "tools": TOOLS,
        "temperature": 0.2,
    }
    headers = {
        "Authorization": f"Bearer {api_key()}",
        "Content-Type": "application/json",
    }
    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
            resp = await client.post(f"{base_url()}/chat/completions", json=payload, headers=headers)
    except httpx.HTTPError as exc:
        raise AIError(502, f"Could not reach the AI provider: {exc}")

    if resp.status_code == 401:
        raise AIError(502, "The AI provider rejected the API key. Check OPENAI_API_KEY.")
    if resp.status_code >= 400:
        detail = resp.text[:300]
        raise AIError(502, f"AI provider error {resp.status_code}: {detail}")

    data = resp.json()
    try:
        return data["choices"][0]["message"]
    except (KeyError, IndexError):
        raise AIError(502, "The AI provider returned an unexpected response.")


async def chat(messages: List[Dict[str, Any]], page: str = "") -> Dict[str, Any]:
    """Run one assistant turn, executing any tool calls it asks for."""
    if not configured():
        raise AIError(
            503,
            "The AI assistant is not configured yet. Add an OPENAI_API_KEY secret "
            "to enable it.",
        )

    state = await snapshot()
    system = (
        f"{SYSTEM_PROMPT}\n\nThe user is on the page: {page or '/'}\n\n"
        f"Live hypervisor state (JSON):\n{json.dumps(state, default=str)[:6000]}"
    )
    convo: List[Dict[str, Any]] = [{"role": "system", "content": system}] + messages
    actions: List[Dict[str, Any]] = []

    for _ in range(MAX_TOOL_ROUNDS):
        message = await _complete(convo)
        tool_calls = message.get("tool_calls") or []
        if not tool_calls:
            return {
                "reply": message.get("content") or "",
                "actions": actions,
                "model": model(),
            }

        convo.append(
            {
                "role": "assistant",
                "content": message.get("content") or "",
                "tool_calls": tool_calls,
            }
        )
        for call in tool_calls:
            fn = call.get("function", {})
            name = fn.get("name", "")
            try:
                args = json.loads(fn.get("arguments") or "{}")
            except json.JSONDecodeError:
                args = {}
            try:
                result = await run_tool(name, args)
            except AIError as exc:
                result = {"error": exc.detail}
            except Exception as exc:  # keep the loop alive, tell the model
                result = {"error": str(exc)}

            actions.append({"tool": name, "arguments": args, "result": result})
            convo.append(
                {
                    "role": "tool",
                    "tool_call_id": call.get("id", ""),
                    "content": json.dumps(result, default=str),
                }
            )

    return {
        "reply": "I stopped after several steps — tell me which fix you want and I'll continue.",
        "actions": actions,
        "model": model(),
    }
