import asyncio
import os
import random
import socket
from typing import List, Dict, Any

from models.vm import VMConfig

# Maps vm_id -> {"process": asyncio.subprocess.Process, "monitor_socket": str, "vnc_port": int}
running_vms: Dict[str, Any] = {}


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


def build_qemu_args(vm: VMConfig) -> List[str]:
    """Build the complete qemu-system-x86_64 argument list for the given VM config."""
    args = ["qemu-system-x86_64"]

    # Name
    args += ["-name", vm.name]

    # Machine type
    if vm.enable_kvm:
        args += ["-machine", f"{vm.machine_type},accel=kvm"]
    else:
        args += ["-machine", vm.machine_type]

    # CPU
    args += ["-cpu", vm.cpu_model]
    args += ["-smp", str(vm.cpu_cores)]
    args += ["-m", str(vm.ram_mb)]

    # Disk
    if vm.disk_path:
        args += ["-drive", f"file={vm.disk_path},format={vm.disk_format},if=virtio,cache=writeback"]

    # CD-ROM / ISO
    if vm.iso_path:
        args += ["-cdrom", vm.iso_path]

    # Boot order
    args += ["-boot", f"order={vm.boot_order}"]

    # Network
    mac_suffix = ":".join([f"{random.randint(0, 255):02x}" for _ in range(3)])
    mac = f"52:54:00:{mac_suffix}"

    if vm.network_type == "nat":
        args += ["-netdev", "user,id=net0"]
        args += ["-device", f"{vm.network_interface},netdev=net0,mac={mac}"]
    elif vm.network_type == "bridged":
        args += ["-netdev", "bridge,id=net0,br=br0"]
        args += ["-device", f"{vm.network_interface},netdev=net0"]
    elif vm.network_type == "host-only":
        args += ["-netdev", "user,id=net0,restrict=on"]
        args += ["-device", f"{vm.network_interface},netdev=net0,mac={mac}"]
    # "none" — skip network args

    # VNC display
    display = vm.vnc_port - 5900
    vnc_arg = f":{display}"
    if vm.vnc_password:
        vnc_arg += ",password=on"
    args += ["-vnc", vnc_arg]

    # Monitor socket
    monitor_socket = f"/tmp/qemu-{vm.id}.sock"
    args += ["-monitor", f"unix:{monitor_socket},server,nowait"]

    # USB
    if vm.usb_enabled:
        args += ["-usb", "-device", "usb-tablet"]

    # Sound
    if vm.sound_enabled:
        args += ["-audiodev", "pa,id=audio0"]
        args += ["-device", f"{vm.sound_model},audiodev=audio0"]

    # UEFI
    if vm.enable_uefi:
        args += ["-bios", "/usr/share/ovmf/OVMF.fd"]

    return args


async def start_vm(vm: VMConfig) -> None:
    """Create disk if missing, then launch QEMU and register the process."""
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
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    running_vms[vm.id] = {
        "process": process,
        "monitor_socket": monitor_socket,
        "vnc_port": vnc_port,
    }


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
