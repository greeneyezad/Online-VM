from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime
import uuid


class Snapshot(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
    description: str = ""


class PortForward(BaseModel):
    protocol: str = "tcp"  # tcp | udp
    host_port: int
    guest_port: int


class VMConfig(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    description: str = ""
    tags: List[str] = []
    status: str = "stopped"  # stopped, running, paused, error
    cpu_cores: int = 2
    cpu_model: str = "host"
    ram_mb: int = 2048
    disk_size_gb: int = 20
    disk_path: str = ""
    disk_format: str = "qcow2"
    disk_bus: str = "virtio"       # virtio | scsi | ide
    disk_cache: str = "writeback"  # writeback | none | writethrough | unsafe | directsync
    iso_path: Optional[str] = None
    network_type: str = "nat"
    network_interface: str = "virtio-net-pci"
    mac_address: Optional[str] = None
    port_forwards: List[PortForward] = []
    display_type: str = "vnc"
    vnc_port: int = 5900
    vnc_password: Optional[str] = None
    boot_order: str = "dc"
    enable_kvm: bool = True
    enable_uefi: bool = False
    secure_boot: bool = False
    machine_type: str = "q35"
    usb_enabled: bool = True
    sound_enabled: bool = False
    sound_model: str = "ich9-intel-hda"
    shared_clipboard: bool = False
    # Direct kernel boot (skip the BIOS/bootloader).
    kernel_path: Optional[str] = None
    initrd_path: Optional[str] = None
    kernel_cmdline: str = ""
    # Virtualization features.
    nested_virt: bool = False
    enable_vtpm: bool = False
    created_at: datetime = Field(default_factory=datetime.utcnow)
    snapshots: List[Snapshot] = []


class VMCreate(BaseModel):
    name: str
    description: str = ""
    tags: List[str] = []
    cpu_cores: int = 2
    cpu_model: str = "host"
    ram_mb: int = 2048
    disk_size_gb: int = 20
    disk_format: str = "qcow2"
    disk_bus: str = "virtio"
    disk_cache: str = "writeback"
    iso_path: Optional[str] = None
    network_type: str = "nat"
    network_interface: str = "virtio-net-pci"
    mac_address: Optional[str] = None
    port_forwards: List[PortForward] = []
    display_type: str = "vnc"
    vnc_password: Optional[str] = None
    boot_order: str = "dc"
    enable_kvm: bool = True
    enable_uefi: bool = False
    secure_boot: bool = False
    machine_type: str = "q35"
    usb_enabled: bool = True
    sound_enabled: bool = False
    sound_model: str = "ich9-intel-hda"
    kernel_path: Optional[str] = None
    initrd_path: Optional[str] = None
    kernel_cmdline: str = ""
    nested_virt: bool = False
    enable_vtpm: bool = False


class VMUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    tags: Optional[List[str]] = None
    cpu_cores: Optional[int] = None
    cpu_model: Optional[str] = None
    ram_mb: Optional[int] = None
    iso_path: Optional[str] = None
    disk_format: Optional[str] = None
    disk_bus: Optional[str] = None
    disk_cache: Optional[str] = None
    network_type: Optional[str] = None
    network_interface: Optional[str] = None
    mac_address: Optional[str] = None
    port_forwards: Optional[List[PortForward]] = None
    display_type: Optional[str] = None
    vnc_password: Optional[str] = None
    boot_order: Optional[str] = None
    enable_kvm: Optional[bool] = None
    enable_uefi: Optional[bool] = None
    secure_boot: Optional[bool] = None
    machine_type: Optional[str] = None
    usb_enabled: Optional[bool] = None
    sound_enabled: Optional[bool] = None
    sound_model: Optional[str] = None
    kernel_path: Optional[str] = None
    initrd_path: Optional[str] = None
    kernel_cmdline: Optional[str] = None
    nested_virt: Optional[bool] = None
    enable_vtpm: Optional[bool] = None
