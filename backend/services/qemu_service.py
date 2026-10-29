import asyncio
import fcntl
import os
import random
import shutil
import signal
import socket
import stat
import subprocess
from functools import lru_cache
from typing import Dict, List, Any, Optional

from models.vm import VMConfig

KVM_DEVICE = "/dev/kvm"
KVM_MAJOR, KVM_MINOR = 10, 232
KVM_GET_API_VERSION = 0xAE00  # _IO(0xAE, 0x00) — returns 12 on every KVM kernel
QEMU_BINARY = "qemu-system-x86_64"
OVMF_PATH = "/usr/share/ovmf/OVMF.fd"
# Secure Boot needs the SMM-enabled OVMF build plus a variable store that
# carries the Microsoft keys — the plain OVMF.fd has neither, and Windows 11's
# installer refuses to run without them.
SECURE_BOOT_CODE_PATH = "/usr/share/OVMF/OVMF_CODE_4M.secboot.fd"
SECURE_BOOT_VARS_PATH = "/usr/share/OVMF/OVMF_VARS_4M.ms.fd"
UEFI_VARS_DIR = "/data/uefi"

# Disk formats the UI offers, and the QEMU image driver behind each one: a .vhd
# file is QEMU's "vpc" driver, everything else shares its name.
DISK_FORMATS = ("qcow2", "raw", "vhd", "vhdx")
DISK_DRIVERS = {"qcow2": "qcow2", "raw": "raw", "vhd": "vpc", "vhdx": "vhdx"}

# Memory kept for the API, the web dev server and the OS itself.
HOST_RESERVE_MB = 2048

# Upper bound offered for a single VM, even on a host with much more RAM.
RAM_CEILING_MB = 16384

# Per-VM swtpm state (vTPM NVRAM) lives here.
TPM_DIR = "/data/tpm"

# Maps vm_id -> {"process": asyncio.subprocess.Process, "monitor_socket": str, "vnc_port": int}
running_vms: Dict[str, Any] = {}


# ──────────────────────────────────────────────
# Host capabilities
# ──────────────────────────────────────────────

@lru_cache(maxsize=1)
def _kernel_exposes_kvm() -> bool:
    """True when the running kernel registered the KVM misc device."""
    try:
        with open("/proc/misc") as f:
            return any(line.split()[-1] == "kvm" for line in f)
    except OSError:
        return False


def _ensure_kvm_device() -> None:
    """Create /dev/kvm inside the container when the host kernel has KVM.

    A container gets its own /dev, so a host KVM device is only visible when it
    is passed in explicitly. When the kernel does support KVM (it shows up in
    /proc/misc) and the service is allowed the device's cgroup rule (see
    docker-compose.base44.yml), mknod is enough — KVM then works with no
    compose edit. On hosts without KVM this is a no-op.
    """
    if os.path.exists(KVM_DEVICE) or not _kernel_exposes_kvm():
        return
    try:
        os.mknod(KVM_DEVICE, stat.S_IFCHR | 0o666, os.makedev(KVM_MAJOR, KVM_MINOR))
    except OSError:
        pass


def _kvm_device_usable() -> bool:
    """Open /dev/kvm and ask it for its API version.

    A node that merely exists is not enough: a bind-mounted directory or a
    device node on a kernel without KVM both fail on open/ioctl and must never
    be reported as hardware acceleration.
    """
    try:
        fd = os.open(KVM_DEVICE, os.O_RDWR | os.O_CLOEXEC)
    except OSError:
        return False
    try:
        return fcntl.ioctl(fd, KVM_GET_API_VERSION) == 12
    except OSError:
        return False
    finally:
        os.close(fd)


@lru_cache(maxsize=1)
def kvm_available() -> bool:
    """True when KVM really works for this container, not just when a node exists."""
    _ensure_kvm_device()
    return _kvm_device_usable()


def kvm_unavailable_reason() -> str:
    """User-facing explanation of why KVM can't be used ("" when it can)."""
    if kvm_available():
        return ""
    if os.path.exists(KVM_DEVICE):
        return ("/dev/kvm exists but cannot be opened, so QEMU stays on software "
                "emulation. Pass the device into the container (--device /dev/kvm).")
    if _kernel_exposes_kvm():
        return ("The host kernel supports KVM but the device is not usable in this "
                "container. Mount /dev/kvm or allow the device cgroup rule.")
    return ("This host exposes no KVM: the kernel has no /dev/kvm and the CPU offers "
            "no virtualization extensions (the app is running inside a guest "
            "without nested virtualization).")


def tcg_tb_size_mb(cores: int) -> int:
    """Translation-block cache per vCPU thread for TCG, in MB.

    Every vCPU thread gets its own buffer, so this is sized against the vCPU
    count to keep the total near 1 GB: a bigger cache speeds up the
    boot/install work software emulation spends nearly all its time on without
    competing with the guest's own RAM.
    """
    return max(32, min(256, 1024 // max(1, cores)))


def accelerator(vm: Optional[VMConfig] = None) -> str:
    """The accelerator QEMU will use for this VM: 'kvm' when available, else 'tcg'."""
    if vm is not None and not vm.enable_kvm:
        return "tcg"
    return "kvm" if kvm_available() else "tcg"


@lru_cache(maxsize=1)
def qemu_version() -> str:
    try:
        out = subprocess.check_output([QEMU_BINARY, "--version"], text=True)
        return out.splitlines()[0].replace("QEMU emulator version", "").strip()
    except Exception:
        return "unknown"


def host_ram_mb() -> int:
    """Total RAM of the host, in MB (0 when it can't be read)."""
    try:
        with open("/proc/meminfo") as f:
            for line in f:
                if line.startswith("MemTotal:"):
                    return int(line.split()[1]) // 1024
    except OSError:
        pass
    return 0


def host_swap_mb() -> int:
    """Swap the host can page guest RAM into, in MB (0 when there is none)."""
    total = 0
    try:
        with open("/proc/swaps") as f:
            next(f, None)  # header line
            for line in f:
                fields = line.split()
                if len(fields) >= 3:
                    total += int(fields[2]) // 1024  # kB -> MB
    except (OSError, ValueError):
        pass
    return total


def max_ram_mb() -> int:
    """Largest guest RAM this host can back for a single VM.

    QEMU maps the whole guest RAM up front and commits pages as the guest
    touches them, so physical RAM *plus* swap is what a VM can really use —
    asking for more is what gets QEMU killed by the OOM killer. In the sandbox
    the `swap` compose service provides that swap, which is what makes the
    16 GB ceiling reachable on an 8 GB host.
    """
    total = host_ram_mb()
    if not total:
        return RAM_CEILING_MB
    allocatable = (total + host_swap_mb() - HOST_RESERVE_MB) // 512 * 512
    return max(512, min(RAM_CEILING_MB, allocatable))


@lru_cache(maxsize=1)
def vtpm_available() -> bool:
    """True when swtpm is installed — it is what actually backs a virtual TPM."""
    return shutil.which("swtpm") is not None


def disk_driver(fmt: Optional[str]) -> str:
    """QEMU image driver name for a logical disk format (vhd → vpc)."""
    return DISK_DRIVERS.get((fmt or "qcow2").lower(), "qcow2")


def secure_boot_available() -> bool:
    return os.path.exists(SECURE_BOOT_CODE_PATH) and os.path.exists(SECURE_BOOT_VARS_PATH)


def uefi_vars_path(vm_id: str) -> str:
    return f"{UEFI_VARS_DIR}/{vm_id}_VARS.fd"


def ensure_uefi_vars(vm_id: str) -> None:
    """Give this VM its own Secure Boot variable store (it stores its own keys)."""
    path = uefi_vars_path(vm_id)
    if not os.path.exists(path):
        os.makedirs(UEFI_VARS_DIR, exist_ok=True)
        shutil.copyfile(SECURE_BOOT_VARS_PATH, path)


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
        "kvm_reason": kvm_unavailable_reason(),
        "qemu_version": qemu_version(),
        "ovmf_available": os.path.exists(OVMF_PATH),
        "host_ram_mb": host_ram_mb(),
        "host_swap_mb": host_swap_mb(),
        "max_ram_mb": max_ram_mb(),
        "ram_ceiling_mb": RAM_CEILING_MB,
        "vtpm_available": vtpm_available(),
        "cpu_models": cpu_models,
        "machine_types": ["q35", "pc-i440fx"],
        "disk_buses": ["virtio", "scsi", "sata"],
        "disk_cache_modes": ["writeback", "none", "writethrough", "unsafe", "directsync"],
        "disk_formats": list(DISK_FORMATS),
        "secure_boot_available": secure_boot_available(),
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


def tpm_socket(vm_id: str) -> str:
    """Unix socket QEMU uses to talk to the VM's swtpm daemon."""
    return f"/tmp/swtpm-{vm_id}.sock"


def tpm_state_dir(vm_id: str) -> str:
    """Directory holding the VM's persisted TPM state."""
    return f"{TPM_DIR}/{vm_id}"


def tpm_device(vm: VMConfig) -> str:
    """CRB is the interface Windows 11 expects; TIS is the older one."""
    return "tpm-crb" if (vm.machine_type or "q35") == "q35" else "tpm-tis"


def build_qemu_args(vm: VMConfig) -> List[str]:
    """Build the complete qemu-system-x86_64 argument list for the given VM config."""
    accel = accelerator(vm)
    args = [QEMU_BINARY, "-name", vm.name]

    # Machine type + accelerator. TCG is the fallback when the host has no KVM,
    # so VMs still boot (slowly) instead of failing outright.
    use_secure_boot = bool(vm.enable_uefi and vm.secure_boot and secure_boot_available())
    # Secure Boot runs the firmware in System Management Mode.
    machine = f"{vm.machine_type},smm=on" if use_secure_boot else vm.machine_type
    if accel == "kvm":
        args += ["-machine", f"{machine},accel=kvm"]
    else:
        args += ["-machine", machine,
                 "-accel", f"tcg,thread=multi,tb-size={tcg_tb_size_mb(vm.cpu_cores)}"]

    # CPU model: "host" passes the host CPU through and is KVM-only, so under
    # TCG it becomes "max" (everything the emulator supports).
    cpu_model = vm.cpu_model or "host"
    if accel == "tcg" and cpu_model == "host":
        cpu_model = "max"
    if vm.nested_virt:
        # Expose VMX/SVM so the guest can run its own hypervisor (needs KVM).
        cpu_model = f"{cpu_model},+vmx"
    args += ["-cpu", cpu_model]
    args += ["-smp", str(vm.cpu_cores)]
    args += ["-m", str(vm.ram_mb)]
    args += ["-rtc", "base=utc"]

    # Disk. Each bus needs its own controller wiring: `if=scsi` / `if=ide` only
    # work on machine types that actually expose those buses, so SCSI and SATA
    # are attached explicitly to a virtio-scsi / AHCI controller.
    if vm.disk_path:
        drive = (f"file={vm.disk_path},format={disk_driver(vm.disk_format)},"
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

    # Direct kernel boot: skips the firmware/bootloader entirely.
    if vm.kernel_path:
        args += ["-kernel", vm.kernel_path]
        if vm.initrd_path:
            args += ["-initrd", vm.initrd_path]
        if vm.kernel_cmdline:
            args += ["-append", vm.kernel_cmdline]

    # Boot order
    args += ["-boot", f"order={vm.boot_order or 'dc'}"]

    # Network. The NIC must name its backend explicitly: a bare `-device
    # virtio-net-pci` is created without a peer ("nic ... has no peer"), so the
    # guest sees a link-less card — no DHCP, no internet, and hostfwd rules are
    # never reachable.
    if vm.network_type != "none":
        args += ["-netdev", _netdev(vm)]
        device = f"{vm.network_interface or 'virtio-net-pci'},netdev=net0"
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

    # Virtual TPM 2.0 (backed by a per-VM swtpm daemon). Windows 11 and other
    # modern OSes refuse to install without one.
    if vm.enable_vtpm:
        args += [
            "-chardev", f"socket,id=chrtpm,path={tpm_socket(vm.id)}",
            "-tpmdev", "emulator,id=tpm0,chardev=chrtpm",
            "-device", f"{tpm_device(vm)},tpmdev=tpm0",
        ]

    # Monitor socket
    args += ["-monitor", f"unix:/tmp/qemu-{vm.id}.sock,server,nowait"]

    # USB
    if vm.usb_enabled:
        args += ["-usb", "-device", "usb-tablet"]

    # Sound
    if vm.sound_enabled:
        args += ["-audiodev", "pa,id=audio0"]
        args += ["-device", f"{vm.sound_model},audiodev=audio0"]

    # UEFI. Secure Boot uses the split SMM-enabled firmware (code pflash is
    # read-only, the per-VM vars copy holds keys and boot entries); plain UEFI
    # keeps the single combined firmware image.
    if use_secure_boot:
        args += [
            "-drive", f"if=pflash,format=raw,unit=0,file={SECURE_BOOT_CODE_PATH},readonly=on",
            "-drive", f"if=pflash,format=raw,unit=1,file={uefi_vars_path(vm.id)}",
            "-global", "driver=cfi.pflash01,property=secure,value=on",
        ]
    elif vm.enable_uefi:
        args += ["-bios", OVMF_PATH]

    return args


# ──────────────────────────────────────────────
# vTPM
# ──────────────────────────────────────────────

def _tpm_log_tail(vm_id: str) -> str:
    """Last lines of this VM's swtpm log, for readable start failures."""
    try:
        with open(f"{tpm_state_dir(vm_id)}/swtpm.log", errors="replace") as f:
            lines = [ln.strip() for ln in f.read().splitlines() if ln.strip()]
    except OSError:
        return ""
    return lines[-1] if lines else ""


async def _start_swtpm(vm: VMConfig) -> asyncio.subprocess.Process:
    """Launch the swtpm process that backs this VM's virtual TPM 2.0.

    Any daemon left behind by an earlier run is stopped first: two swtpm
    instances on one state directory fight over its lock and corrupt the
    guest's TPM NVRAM, so this must happen before every start.

    swtpm stays a tracked child (no `--daemon`): daemonizing reparents it to
    PID 1, whose exit is never reaped, so every stop/start cycle left another
    zombie behind.
    """
    await _stop_vtpm(vm.id)
    os.makedirs(tpm_state_dir(vm.id), exist_ok=True)
    sock = tpm_socket(vm.id)
    if os.path.exists(sock):
        os.remove(sock)

    proc = await asyncio.create_subprocess_exec(
        "swtpm", "socket", "--tpm2",
        "--tpmstate", f"dir={tpm_state_dir(vm.id)}",
        "--ctrl", f"type=unixio,path={sock}",
        "--log", f"file={tpm_state_dir(vm.id)}/swtpm.log,level=3",
        "--terminate",
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.DEVNULL,
    )
    # Reap it whenever it exits (a guest powerdown closes the chardev and
    # `--terminate` ends the process).
    asyncio.create_task(_reap_tpm(proc))

    # QEMU needs the control socket to exist before it connects.
    for _ in range(60):
        if os.path.exists(sock):
            return proc
        if proc.returncode is not None:
            break
        await asyncio.sleep(0.05)

    if proc.returncode is None:
        proc.terminate()
        await proc.wait()
        raise RuntimeError("swtpm control socket did not appear")
    detail = _tpm_log_tail(vm.id)
    raise RuntimeError(
        "swtpm could not start the virtual TPM"
        + (f": {detail}" if detail else "")
    )


async def _reap_tpm(proc: asyncio.subprocess.Process) -> None:
    """Wait for a tracked swtpm process so its exit is reaped."""
    try:
        await proc.wait()
    except Exception:
        pass


def _pid_state(pid: int) -> str:
    """One-letter process state from /proc ("" when the process is gone)."""
    try:
        with open(f"/proc/{pid}/status") as f:
            for line in f:
                if line.startswith("State:"):
                    return line.split()[1]
    except OSError:
        pass
    return ""


async def _stop_vtpm(vm_id: str) -> None:
    """Stop this VM's swtpm process(es) and drop the stale socket.

    A graceful powerdown closes the chardev and swtpm exits on its own
    (`--terminate`), but a force-stop kills QEMU abruptly. Leftovers from an
    earlier API worker are found through /proc (the image has no ps); the
    tracked child is awaited so it is reaped rather than left as a zombie.
    """
    entry = running_vms.get(vm_id)
    own = entry.get("tpm_process") if entry else None
    sock = tpm_socket(vm_id)
    state_dir = tpm_state_dir(vm_id)

    stale = []
    for name in os.listdir("/proc"):
        if not name.isdigit():
            continue
        pid = int(name)
        if own is not None and pid == own.pid:
            continue
        try:
            with open(f"/proc/{name}/cmdline", "rb") as f:
                cmdline = f.read().decode(errors="replace")
        except OSError:
            continue
        # Match the state dir as well as the socket: a daemon from an earlier
        # start may hold the same TPM state under a different socket path.
        if "swtpm" in cmdline and (sock in cmdline or state_dir in cmdline):
            try:
                os.kill(pid, signal.SIGTERM)
                stale.append(pid)
            except OSError:
                pass

    if own is not None:
        if own.returncode is None:
            own.terminate()
        try:
            await asyncio.wait_for(own.wait(), timeout=3)
        except asyncio.TimeoutError:
            own.kill()
            await own.wait()
        if entry is not None:
            entry.pop("tpm_process", None)

    # Wait for stale processes to release the state lock (a zombie is exited).
    for _ in range(40):
        if all(_pid_state(pid) in ("", "Z") for pid in stale):
            break
        await asyncio.sleep(0.05)

    try:
        if os.path.exists(sock):
            os.remove(sock)
    except OSError:
        pass


# ──────────────────────────────────────────────
# Lifecycle
# ──────────────────────────────────────────────

async def start_vm(vm: VMConfig) -> None:
    """Create disk if missing, then launch QEMU and register the process."""
    if vm.ram_mb > max_ram_mb():
        raise RuntimeError(
            f"{vm.ram_mb} MB of RAM is more than this host can give a VM "
            f"(limit {max_ram_mb()} MB of {host_ram_mb()} MB total). "
            "Lower the VM's RAM in its settings."
        )

    if vm.iso_path and not os.path.exists(vm.iso_path):
        raise RuntimeError(f"ISO image not found: {vm.iso_path}")

    if vm.secure_boot:
        if not vm.enable_uefi:
            raise RuntimeError("Secure Boot needs UEFI firmware enabled for this VM")
        if not secure_boot_available():
            raise RuntimeError("Secure Boot firmware (OVMF secboot) is not installed in this image")

    # Create disk image if it doesn't exist yet
    if vm.disk_path and not os.path.exists(vm.disk_path):
        await create_disk(vm.disk_path, vm.disk_size_gb, vm.disk_format)

    if vm.enable_uefi and vm.secure_boot:
        ensure_uefi_vars(vm.id)

    tpm_process = None
    if vm.enable_vtpm:
        if not vtpm_available():
            raise RuntimeError(
                "vTPM needs swtpm, which is not installed in this image"
            )
        tpm_process = await _start_swtpm(vm)

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
        "tpm_process": tpm_process,
    }

    # Give QEMU a moment to fail fast (bad config, missing firmware, ...) so the
    # API can report the real reason instead of a silently dead VM.
    await asyncio.sleep(0.8)
    if process.returncode is not None:
        stderr = (await process.stderr.read()).decode(errors="replace").strip()
        # QEMU never connected to the TPM, so `--terminate` won't fire: drop the
        # daemon here or the next start inherits a locked state directory.
        await _stop_vtpm(vm.id)
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
        process = entry.get("process")
        if process is not None:
            process.kill()
            await process.wait()
        elif entry.get("pid"):
            try:
                os.kill(entry["pid"], signal.SIGKILL)
            except OSError:
                pass
    await _stop_vtpm(vm_id)
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
    process = entry.get("process")
    if process is None:
        # Adopted after a worker reload: only the pid is known.
        return bool(entry.get("pid")) and os.path.exists(f"/proc/{entry['pid']}")
    return process.returncode is None


def adopt_running(vms: List[VMConfig]) -> int:
    """Re-register guests left running by a previous API worker.

    `uvicorn --reload` replaces the worker on every backend edit and the
    registry lives in memory, so a running guest keeps going with nothing
    tracking it: the UI calls it stopped, its console/stop/monitor actions stop
    working, and starting it again would open the same disk image twice. Each
    QEMU process is matched back to its VM through the disk on its command line.
    """
    by_disk = {os.path.abspath(v.disk_path): v for v in vms if v.disk_path}
    adopted = 0
    for name in os.listdir("/proc"):
        if not name.isdigit():
            continue
        pid = int(name)
        try:
            with open(f"/proc/{name}/cmdline", "rb") as f:
                cmdline = f.read().decode(errors="replace")
        except OSError:
            continue
        if QEMU_BINARY not in cmdline:
            continue
        disk = ""
        for part in cmdline.split("\0"):
            if part.startswith("file="):
                disk = part.split(",")[0][len("file="):]
                break
        vm = by_disk.get(os.path.abspath(disk)) if disk else None
        if not vm or vm.id in running_vms:
            continue
        monitor = f"/tmp/qemu-{vm.id}.sock"
        if not os.path.exists(monitor):
            continue
        running_vms[vm.id] = {
            "process": None,
            "pid": pid,
            "monitor_socket": monitor,
            "vnc_port": vm.vnc_port or 5900,
        }
        adopted += 1
    return adopted


async def create_disk(path: str, size_gb: int, fmt: str) -> None:
    """Create a new QEMU disk image using qemu-img."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    driver = disk_driver(fmt)
    cmd = ["qemu-img", "create", "-f", driver]
    if driver == "vpc":
        # VHD grows with the data written, like qcow2.
        cmd += ["-o", "subformat=dynamic"]
    cmd += [path, f"{size_gb}G"]
    process = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await process.communicate()
    if process.returncode != 0:
        raise RuntimeError(f"qemu-img create failed: {stderr.decode()}")


async def convert_disk(src: str, dst: str, fmt: str, src_fmt: Optional[str] = None) -> None:
    """Rewrite a disk image into another format (qemu-img convert).

    A half-written target is removed, so a failed conversion never leaves a
    truncated disk behind that later looks usable.
    """
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    cmd = ["qemu-img", "convert"]
    if src_fmt:
        cmd += ["-f", disk_driver(src_fmt)]
    cmd += ["-O", disk_driver(fmt), src, dst]
    process = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await process.communicate()
    if process.returncode != 0:
        try:
            os.remove(dst)
        except OSError:
            pass
        raise RuntimeError(stderr.decode().strip() or "qemu-img convert failed")
