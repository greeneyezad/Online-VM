from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime
import uuid


class Snapshot(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
    description: str = ""


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
    iso_path: Optional[str] = None
    network_type: str = "nat"
    network_interface: str = "virtio-net-pci"
    display_type: str = "vnc"
    vnc_port: int = 5900
    vnc_password: Optional[str] = None
    boot_order: str = "dc"
    enable_kvm: bool = True
    enable_uefi: bool = False
    machine_type: str = "q35"
    usb_enabled: bool = True
    sound_enabled: bool = False
    sound_model: str = "ich9-intel-hda"
    shared_clipboard: bool = False
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
    iso_path: Optional[str] = None
    network_type: str = "nat"
    network_interface: str = "virtio-net-pci"
    display_type: str = "vnc"
    vnc_password: Optional[str] = None
    boot_order: str = "dc"
    enable_kvm: bool = True
    enable_uefi: bool = False
    machine_type: str = "q35"
    usb_enabled: bool = True
    sound_enabled: bool = False
    sound_model: str = "ich9-intel-hda"


class VMUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    tags: Optional[List[str]] = None
    cpu_cores: Optional[int] = None
    cpu_model: Optional[str] = None
    ram_mb: Optional[int] = None
    iso_path: Optional[str] = None
    network_type: Optional[str] = None
    network_interface: Optional[str] = None
    display_type: Optional[str] = None
    vnc_password: Optional[str] = None
    boot_order: Optional[str] = None
    enable_kvm: Optional[bool] = None
    enable_uefi: Optional[bool] = None
    machine_type: Optional[str] = None
    usb_enabled: Optional[bool] = None
    sound_enabled: Optional[bool] = None
    sound_model: Optional[str] = None
