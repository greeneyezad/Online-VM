// Disk image formats the API accepts, with what each one is good for.
export const DISK_FORMAT_HINTS = {
  qcow2: 'qcow2 — dynamic allocation, snapshots supported',
  raw: 'raw — fixed size, slightly faster',
  vhd: 'vhd — Virtual PC/VHD, dynamic (Hyper-V, VirtualBox)',
  vhdx: 'vhdx — VHDX, dynamic (Hyper-V, large disks)',
}
