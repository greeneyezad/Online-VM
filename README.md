# Online VM — Browser-based Virtual Machine Manager

A full-stack web application that lets you create, manage, and connect to QEMU/KVM virtual machines from any browser.

## Screenshots

> _Screenshots coming soon_

## Features

- **Full VM lifecycle**: Create, start, stop, pause, resume, reset, and delete VMs
- **Hardware configuration**: CPU model (host/EPYC/Haswell/Skylake), vCPU count (1-64), RAM (512MB-64GB), KVM acceleration
- **Storage**: qcow2 and raw disk formats, configurable disk size, ISO attach/detach
- **Networking**: NAT, Bridged, Host-only, and No-network modes; VirtIO/e1000/RTL8139 adapters
- **Display**: VNC browser console via WebSocket proxy, noVNC integration
- **UEFI/BIOS**: Optional UEFI firmware (OVMF) for modern distros
- **USB & Sound**: USB tablet input, Intel HDA / AC97 / SoundBlaster sound
- **Snapshots**: Create, restore, and delete VM snapshots via QEMU monitor
- **ISO Management**: Upload and manage ISO images through the web UI
- **Dark UI**: Responsive dark-themed React frontend

## Architecture

```
Browser
  │
  ▼
Nginx (port 80)  ──── static React app
  │
  ▼
FastAPI (port 8000)
  │
  ├── REST API  ──── VM CRUD, ISO management, snapshots
  ├── WebSocket  ──── VNC proxy (ws → TCP)
  │
  ▼
QEMU/KVM
  │
  ├── Virtual machines (qcow2 disks in /data/disks/)
  └── VNC displays (ports 5900+)
```

## Prerequisites

**With Docker (recommended):**
- Linux host with KVM support (`ls /dev/kvm`)
- Docker >= 24 and Docker Compose v2

**Manual:**
- Linux with KVM (`kvm-ok` or `ls /dev/kvm`)
- Python 3.11+
- Node.js 20+
- QEMU (`qemu-system-x86_64`, `qemu-img`)
- OVMF (for UEFI)

## Quick Start (Docker)

```bash
git clone https://github.com/vigilant62/Online-VM
cd Online-VM
docker-compose up --build
```

Open http://localhost in your browser.

## Manual Setup

### Backend
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

Frontend dev server runs on http://localhost:5173 and proxies API calls to the backend.

## Usage

1. Upload an ISO via the **ISO Library** page
2. Click **Create VM** on the Dashboard
3. Configure CPU, RAM, disk, network, and display settings across the 6-tab form
4. Click **Start** on the VM card
5. Click **Console** to open the VNC viewer (or use the noVNC link)

## API Reference

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/vms | List all VMs |
| POST | /api/vms | Create VM |
| GET | /api/vms/{id} | Get VM |
| PUT | /api/vms/{id} | Update VM settings |
| DELETE | /api/vms/{id} | Delete VM |
| POST | /api/vms/{id}/start | Start VM |
| POST | /api/vms/{id}/stop | Graceful stop |
| POST | /api/vms/{id}/force-stop | Force kill |
| POST | /api/vms/{id}/pause | Pause VM |
| POST | /api/vms/{id}/resume | Resume VM |
| POST | /api/vms/{id}/reset | Reset VM |
| GET | /api/vms/{id}/status | Get VM status |
| POST | /api/vms/{id}/snapshot | Create snapshot |
| GET | /api/vms/{id}/snapshots | List snapshots |
| POST | /api/vms/{id}/snapshot/{sid}/restore | Restore snapshot |
| DELETE | /api/vms/{id}/snapshot/{sid} | Delete snapshot |
| GET | /api/isos | List ISOs |
| POST | /api/isos/upload | Upload ISO |
| DELETE | /api/isos/{name} | Delete ISO |
| WS | /ws/vnc/{id} | VNC WebSocket proxy |

## GitHub

https://github.com/vigilant62/Online-VM

## License

MIT
