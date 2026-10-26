import asyncio
import os
import random
import socket
import subprocess
from functools import lru_cache
from typing import Dict, List, Any

from models.vm import VMConfig

KVM_DEVICE = "/dev/kvm"
QEMU_BINARY = "qemu-system-x86_64"
OVMF_PATH = "/usr/share/ovmf/OVMF.fd"

# Maps vm_id -> {"process": asyncio.subprocess.Process, "monitor_socket": str, "vnc_port": int}
running_vms: Dict[str, Any] = {}


# ──────────────────────────────────────────────
# Host capabilities
# ──────────────────────────────────────────────

@lru_cache(maxsize=1)
def kvm_available() -> bool:
    """True when /dev/kvm is present and usable by this container."""
    return os.path.exists(KVM_DEVICE) and os.access(KVM_DEVICE, os.R_OK | os.W_OK)


def accelerator() -> str:
    """The accelerator QEMU will use: 'kvm' when available, else 'tcg'."""
    return "kvm" if kvm_available() else "tcg"


@lru_cache(maxsize=1)
def qemu_version() -> str:
    try:
        out = subprocess.check_output([QEMU_BINARY, "--version"], text=True)
        return out.splitlines()[0].replace("QEMU emulator version", "").strip()
    except Exception:
        return "unknown"


def capabilities() -> Dict[str, Any]:
    """Everything the UI needs to offer only options this host can honour."""
    accel = accelerator()
    cpu_models = ["max", "qemu64", "EPYC", "Haswell", "Skylake-Client",
                  "Broadwell", "Nehalem", "Westmere", "SandyBridge", "IvyBridge"]
    if accel == "kvm":
        cpu_models.insert(0, "host")
    return {
        "accelerator": accel,
        "kvm_available": accel == "kvm",
        "qemu_version": qemu_version(),
        "ovmf_available": os.path.exists(OVMF_PATH),
        "cpu_models": cpu_models,
        "machine_types": ["q35", "pc-i440fx"],
        "disk_buses": ["virtio", "scsi", "sata"],
        "disk_cache_modes": ["writeback", "none", "writethrough", "unsafe", "directsync"],
        "disk_formats": ["qcow2", "raw"],
        "network_types": ["nat", "bridged", "host-only", "none"],
        "network_interfaces": ["virtio-net-pci", "e1000", "rtl8139"],
        "display_types": ["vnc", "none"],
        "sound_models": ["ich9-intel-hda", "ac97", "sb16"],
        "boot_orders": ["dc", "cd", "c", "n"],
    }


# ──────────────────────────────────────────────
# QEMU command line
# ──────────────────────────────────────────────

def find_free_vnc_port() -> int:
    """Scan ports 5900-5999 and return the first free one."""
    used_ports = {v["vnc_port"] for v in running_vms.values()}
    for port in range(5900, 6000):
        if port in used_ports:
            continue
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            s.bind(("127.0.0.1", port))
            s.close()
            return port
        except OSError:
            pass
    raise RuntimeError("No free VNC ports available in range 5900-5999")


def _mac_address(vm: VMConfig) -> str:
    if vm.mac_address:
        return vm.mac_address
    suffix = ":".join([f"{random.randint(0, 255):02x}" for _ in range(3)])
    return f"52:54:00:{suffix}"


def _netdev(vm: VMConfig) -> str:
    if vm.network_type == "bridged":
        return "bridge,id=net0,br=br0"
    netdev = "user,id=net0"
    if vm.network_type == "host-only":
        netdev += ",restrict=on"
    for pf in vm.port_forwards or []:
        proto = (pf.protocol or "tcp").lower()
        if proto not in ("tcp", "udp") or not pf.host_port or not pf.guest_port:
            continue
        netdev += f",hostfwd={proto}::{pf.host_port}-:{pf.guest_port}"
    return netdev


def build_qemu_args(vm: VMConfig) -> List[str]:
    """Build the complete qemu-system-x86_64 argument list for the given VM config."""
    accel = accelerator()
    args = [QEMU_BINARY, "-name", vm.name]

    # Machine type + accelerator. TCG is the fallback when the host has no KVM,
    # so VMs still boot (slowly) instead of failing outright.
    if accel == "kvm":
        args += ["-machine", f"{vm.machine_type},accel=kvm"]
    else:
        args += ["-machine", vm.machine_type, "-accel", "tcg,thread=multi"]

    # CPU model: "host" passes the host CPU through and is KVM-only, so under
    # TCG it becomes "max" (everything the emulator supports).
    cpu_model = vm.cpu_model or "host"
    if accel == "tcg" and cpu_model == "host":
        cpu_model = "max"
    args += ["-cpu", cpu_model]
    args += ["-smp", str(vm.cpu_cores)]
    args += ["-m", str(vm.ram_mb)]
    args += ["-rtc", "base=utc"]

    # Disk. Each bus needs its own controller wiring: `if=scsi` / `if=ide` only
    # work on machine types that actually expose those buses, so SCSI and SATA
    # are attached explicitly to a virtio-scsi / AHCI controller.
    if vm.disk_path:
        drive = (f"file={vm.disk_path},format={vm.disk_format},"
                 f"cache={vm.disk_cache or 'writeback'}")
        bus = (vm.disk_bus or "virtio").lower()
        if bus == "scsi":
            args += ["-drive", f"{drive},if=none,id=disk0",
                     "-device", "virtio-scsi-pci,id=scsi0",
                     "-device", "scsi-hd,drive=disk0,bus=scsi0.0"]
        elif bus == "sata":
            args += ["-drive", f"{drive},if=none,id=disk0",
                     "-device", "ich9-ahci,id=ahci",
                     "-device", "ide-hd,drive=disk0,bus=ahci.0"]
        else:
            args += ["-drive", f"{drive},if=virtio"]

    # CD-ROM / ISO
    if vm.iso_path:
        args += ["-cdrom", vm.iso_path]

    # Boot order
    args += ["-boot", f"order={vm.boot_order or 'dc'}"]

    # Network
    if vm.network_type != "none":
        args += ["-netdev", _netdev(vm)]
        device = vm.network_interface or "virtio-net-pci"
        if vm.network_type != "bridged":
            device += f",mac={_mac_address(vm)}"
        args += ["-device", device]

    # Display: VNC when requested, otherwise headless.
    if vm.display_type == "vnc":
        display = vm.vnc_port - 5900
        vnc_arg = f":{display}"
        if vm.vnc_password:
            vnc_arg += ",password=on"
        args += ["-vnc", vnc_arg]
    else:
        args += ["-display", "none"]

    # Monitor socket
    args += ["-monitor", f"unix:/tmp/qemu-{vm.id}.sock,server,nowait"]

    # USB
    if vm.usb_enabled:
        args += ["-usb", "-device", "usb-tablet"]

    # Sound
    if vm.sound_enabled:
        args += ["-audiodev", "pa,id=audio0"]
        args += ["-device", f"{vm.sound_model},audiodev=audio0"]

    # UEFI
    if vm.enable_uefi:
        args += ["-bios", OVMF_PATH]

    return args


# ──────────────────────────────────────────────
# Lifecycle
# ──────────────────────────────────────────────

async def start_vm(vm: VMConfig) -> None:
    """Create disk if missing, then launch QEMU and register the process."""
    if vm.iso_path and not os.path.exists(vm.iso_path):
        raise RuntimeError(f"ISO image not found: {vm.iso_path}")

    # Create disk image if it doesn't exist yet
    if vm.disk_path and not os.path.exists(vm.disk_path):
        await create_disk(vm.disk_path, vm.disk_size_gb, vm.disk_format)

    # Pick a free VNC port
    vnc_port = find_free_vnc_port()
    vm.vnc_port = vnc_port

    args = build_qemu_args(vm)
    monitor_socket = f"/tmp/qemu-{vm.id}.sock"

    process = await asyncio.create_subprocess_exec(
        *args,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
    )

    running_vms[vm.id] = {
        "process": process,
        "monitor_socket": monitor_socket,
        "vnc_port": vnc_port,
    }

    # Give QEMU a moment to fail fast (bad config, missing firmware, ...) so the
    # API can report the real reason instead of a silently dead VM.
    await asyncio.sleep(0.8)
    if process.returncode is not None:
        stderr = (await process.stderr.read()).decode(errors="replace").strip()
        running_vms.pop(vm.id, None)
        raise RuntimeError(stderr or f"QEMU exited with code {process.returncode}")

    # "password=on" only enables password auth; the password itself has to be
    # set on the running instance through the monitor.
    if vm.display_type == "vnc" and vm.vnc_password:
        await send_monitor_command(vm.id, f"change vnc password {vm.vnc_password}")


async def stop_vm(vm_id: str) -> None:
    """Send a graceful powerdown command via the QEMU monitor."""
    await send_monitor_command(vm_id, "system_powerdown")


async def force_stop_vm(vm_id: str) -> None:
    """Kill the QEMU process immediately."""
    entry = running_vms.get(vm_id)
    if entry:
        entry["process"].kill()
        await entry["process"].wait()
        running_vms.pop(vm_id, None)


async def pause_vm(vm_id: str) -> None:
    """Pause (freeze) VM execution via the QEMU monitor."""
    await send_monitor_command(vm_id, "stop")


async def resume_vm(vm_id: str) -> None:
    """Resume a paused VM via the QEMU monitor."""
    await send_monitor_command(vm_id, "cont")


async def reset_vm(vm_id: str) -> None:
    """Hard-reset the VM via the QEMU monitor."""
    await send_monitor_command(vm_id, "system_reset")


async def send_monitor_command(vm_id: str, command: str) -> str:
    """Open the QEMU HMP monitor Unix socket, send a command, and return the response."""
    entry = running_vms.get(vm_id)
    if not entry:
        return ""

    monitor_socket = entry["monitor_socket"]

    try:
        reader, writer = await asyncio.open_unix_connection(monitor_socket)

        # Read the QEMU greeting banner
        greeting = await asyncio.wait_for(reader.read(1024), timeout=3.0)

        # Send the command
        writer.write((command + "\n").encode())
        await writer.drain()

        # Read the response
        response = await asyncio.wait_for(reader.read(4096), timeout=5.0)
        writer.close()
        await writer.wait_closed()

        return response.decode(errors="replace").strip()
    except Exception as exc:
        return f"error: {exc}"


def is_running(vm_id: str) -> bool:
    """Return True if the QEMU process for the given VM is still alive."""
    entry = running_vms.get(vm_id)
    if not entry:
        return False
    return entry["process"].returncode is None


async def create_disk(path: str, size_gb: int, fmt: str) -> None:
    """Create a new QEMU disk image using qemu-img."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    process = await asyncio.create_subprocess_exec(
        "qemu-img", "create", "-f", fmt, path, f"{size_gb}G",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await process.communicate()
    if process.returncode != 0:
        raise RuntimeError(f"qemu-img create failed: {stderr.decode()}")
