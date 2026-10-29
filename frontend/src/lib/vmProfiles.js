// Quick profiles: the firmware/hardware a guest OS insists on, in one click.
// Every field here maps to a real VM setting — nothing is applied on the side.
export const QUICK_PROFILES = [
  {
    id: 'windows11',
    label: 'Windows 11',
    description:
      'UEFI + Secure Boot + vTPM 2.0 (all three are Setup requirements), SATA disk and ' +
      'Intel NIC because the installer ships no VirtIO drivers, 4 vCPU / 8 GB / 64 GB.',
    values: {
      cpu_cores: 4,
      ram_mb: 8192,
      disk_size_gb: 64,
      disk_format: 'qcow2',
      disk_bus: 'sata',
      disk_cache: 'writeback',
      machine_type: 'q35',
      enable_uefi: true,
      secure_boot: true,
      enable_vtpm: true,
      network_interface: 'e1000',
      boot_order: 'dc',
      usb_enabled: true,
      sound_enabled: false,
    },
  },
]
