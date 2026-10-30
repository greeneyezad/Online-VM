# Working on this repo in the Base44 sandbox

## Running the app here

The repository's own `docker-compose.yml` is a **production** setup (nginx serving a
prebuilt bundle). The sandbox uses `docker-compose.base44.yml`, which runs both
projects from the cloned source with live reload:

```bash
docker compose -f docker-compose.base44.yml up -d --build
```

| service | what it is | host port |
|---------|------------|-----------|
| `web`   | Vite dev server for `frontend/` (proxies `/api` and `/ws` to the API) | 3000 |
| `api`   | FastAPI/uvicorn (`--reload`) for `backend/` | 8000 |

Non-obvious bits:

- `backend/Dockerfile.base44` exists because the repo's `backend/Dockerfile` copies
  the source into the image (`COPY . .`), which freezes the code. The base44 image
  only installs the system packages (`qemu-system-x86`, `qemu-utils`, `ovmf`, `curl`)
  and the Python requirements; `./backend` is bind-mounted at `/app` instead.
- QEMU packages are only installed in the **api** image. The sandbox host itself has
  no runtimes — run Python/npm commands with
  `docker compose -f docker-compose.base44.yml exec -T api ...` / `... exec -T web ...`.
- `uvicorn --reload` runs with `WATCHFILES_FORCE_POLLING=true`, because bind mounts do
  not reliably emit inotify events.
- `web/node_modules` lives in the `web_node_modules` volume and is (re)installed from
  `frontend/package.json` on every container start. There is no lockfile in the repo,
  so `npm install` (never `npm ci`) is the correct command.
- State (`/data/vms.json`, disk images, uploaded ISOs) is kept in the `vm_data` volume.

## Credentials

The app uses no database — the backend persists to `/data/vms.json`. The only
external service is the AI assistant's chat-completions provider, configured with
`OPENAI_API_KEY` (optional, delivered as a Base44 secret into
`/run/base44/app.env`; see "AI assistant" below). Everything else runs with no
credentials, and the app boots fine without the key.

## Sandbox-only overrides

Everything below is inert outside the sandbox (`BASE44_PREVIEW_MODE` unset or ≠ `1`).

1. `frontend/vite.config.js` reads its proxy targets from `VITE_API_PROXY_TARGET` /
   `VITE_WS_PROXY_TARGET`. They default to the original `http://localhost:8000` /
   `ws://localhost:8000`, so a plain `npm run dev` on a laptop is unchanged; the dev
   compose sets them to `http://api:8000` / `ws://api:8000`.
2. Vite ≥5.4 blocks requests whose `Host` header is not an IP/localhost/allowed host.
   The preview reaches the dev server through the sandbox's proxied hostname, so the
   config appends the `.<BASE44_SANDBOX_HOST_DOMAIN>` wildcard to
   `server.allowedHosts` **only** when `BASE44_PREVIEW_MODE === '1'` and
   `BASE44_SANDBOX_HOST_DOMAIN` is set. Otherwise the `allowedHosts` key is omitted
   entirely and Vite keeps its default behaviour. Both variables are passed into the
   `web` service by the dev compose.
3. KVM: the dev compose does **not** grant `privileged: true`, and this sandbox has no
   KVM at all (the kernel exposes no `/dev/kvm`, `/proc/misc` has no `kvm`, and the CPU
   reports no virtualization extensions — the sandbox is itself a guest without nested
   virtualization). QEMU therefore runs `-accel tcg` here; guests really boot and are
   usable, just slowly. On a KVM-capable host no config change is needed: the api
   service carries `device_cgroup_rules: ["c 10:232 rwm"]` and
   `qemu_service._ensure_kvm_device()` creates the `/dev/kvm` node with `mknod` when the
   kernel exposes KVM, so `kvm_available()` turns true on its own. Detection opens the
   device and checks `KVM_GET_API_VERSION`, so a node that merely exists (bind-mounted
   directory, device on a kernel without KVM) is never reported as acceleration;
   `/api/system` → `kvm_reason` explains any refusal in the UI.
4. The browser console is embedded with `@novnc/novnc`, which is pinned to **1.4.0**:
   1.5+ ships top-level `await`, which Vite's default `es2020` build target (used by
   `frontend/Dockerfile`'s production build) refuses. Don't bump it without raising the
   build target.

## Verifying the stack

```bash
docker compose -f docker-compose.base44.yml ps                              # both healthy
curl -s http://localhost:3000/ | grep '<title>'                             # "Online VM"
curl -s http://localhost:3000/api/vms                                       # [] / VM list
curl -s http://localhost:3000/src/main.jsx -o /dev/null -w '%{http_code}\n' # 200 = dev server serves live source
curl -s http://localhost:8000/health                                        # {"status":"ok"}
```

Compose healthchecks: `GET /health` on the API and `GET /` on the dev server.
There is no test suite in this repository.

## Virtualization backend

- QEMU runs **inside the `api` container**; the sandbox host needs nothing installed.
  `qemu_service.accelerator(vm)` chooses the accelerator per VM: a VM with
  `enable_kvm: false` is forced onto TCG even on a KVM host, otherwise `/dev/kvm` wins.
  With KVM it uses `accel=kvm` + `-cpu host`; without it,
  `-accel tcg,thread=multi,tb-size=<MB>` and `host` is mapped to `max`. Guests boot
  either way — TCG is just slow.
  - KVM is a **kernel** accelerator: it needs `vmx`/`svm` in the guest CPU plus the
    kvm module, so it cannot be created from userspace. This sandbox has neither
    (`/proc/cpuinfo` shows only `hypervisor`, `/proc/misc` has no `kvm`), and no
    amount of app code or container privilege changes that — the truthful answer is
    "run the stack on a KVM-capable host", where detection turns it on by itself.
    Never fake `kvm_available`: `-accel kvm` on this host fails outright.
  - `tcg_tb_size_mb()` sizes the translation-block cache per vCPU thread (32–256 MB,
    ~1 GB total across vCPUs). It is per-thread in MTTCG, so scaling it with the core
    count avoids both a starved cache on 1–2 vCPU guests and gigabytes of waste on
    a 16 vCPU one.
- `GET /api/system` reports what the host can really do (`kvm_available`, `accelerator`,
  QEMU version, plus the option lists). The create/settings forms read it so the UI
  never offers an option the host can't honour.
- Disk buses are wired to real controllers: `virtio` → `-drive if=virtio`;
  `scsi` → `-drive if=none` + `virtio-scsi-pci` + `scsi-hd`;
  `sata` → `-drive if=none` + `ich9-ahci` + `ide-hd`. A bare `-drive if=scsi` fails on
  q35 ("machine type does not support if=scsi"), which is why the devices are explicit.
- A VNC password is set on the running instance through the QEMU monitor
  (`change vnc password …`); `password=on` on its own rejects every client.
- The browser console is noVNC (`@novnc/novnc` 1.4.0) connecting to
  `wss://<same origin>/ws/vnc/<id>`; Vite proxies `/ws` to the API, which relays raw RFB
  over TCP. No direct VNC port is exposed to the browser.
- **A reloaded worker re-adopts running guests.** `uvicorn --reload` replaces the
  worker on every backend edit and the `running_vms` registry is in memory, so a guest
  started before the reload used to keep running untracked: the UI called it stopped
  and a second start would have opened the same disk image twice. `main.py`'s lifespan
  now calls `qemu_service.adopt_running()` (matches each QEMU process to its VM through
  the `file=` disk path on its command line, needs `/tmp/qemu-<id>.sock`) and clears
  "running"/"paused" on VMs whose process is gone. Adopted entries carry `pid` instead
  of a `process` object, which `is_running()`/`force_stop_vm()` handle. Guests do NOT
  survive a full `docker compose restart api`; only reloads are covered.
- **Disk formats** (`disk_format`): `qcow2`, `raw`, `vhd`, `vhdx`. A `.vhd` image is
  QEMU's **`vpc`** driver (`disk_driver()` maps it, and `qemu-img create -o
  subformat=dynamic` keeps it thin); `.vhdx` uses the `vhdx` driver. The format string
  is not cosmetic — QEMU opens the image with that driver, so changing it in the VM
  settings makes `PUT /api/vms/{id}` rewrite the disk with `qemu-img convert`
  (`_convert_disk_format()`), deleting the old image only after a successful convert.
  Internal snapshots (`savevm`) are qcow2-only; `POST /vms/{id}/snapshot` returns 400
  for the other formats.
- Boot time under TCG (no KVM): a 3 GB Ubuntu 24.04 live-server ISO reaches the
  installer language menu in roughly 7 minutes; SeaBIOS prints
  `Boot failed: Could not read CDROM` instantly when the ISO is not attached, so
  that message means `iso_path` is null, not that the ISO is bad.
- Boot smoke test: upload an ISO (`curl -F "file=@x.iso" http://localhost:3000/api/isos/upload`),
  create a VM with `boot_order: "dc"`, open `/vm/<id>` and press Start. VNC readiness:
  `exec -T api python3 -c "import socket;s=socket.create_connection(('127.0.0.1',5900));print(s.recv(12))"`
  → `b'RFB 003.008\n'`.
- **The NIC must name its backend.** `-device virtio-net-pci` without `,netdev=net0`
  gives the guest a link-less card: QEMU warns `nic ... has no peer`, DHCP fails in
  the guest ("Network autoconfiguration failed") and `hostfwd` is unreachable, even
  though `-netdev user` exists. `info network` shows the netdev *nested under* the
  NIC only when it is wired correctly.
- Guests still need the interface up themselves: a fresh Alpine ISO boots with
  `eth0` DOWN, so `ip link set eth0 up` then `udhcpc -i eth0` is required before
  testing internet from inside a guest.

## Modern-OS features

- **RAM**: the create/settings forms offer up to `RAM_CEILING_MB` (16 GB).
  `max_ram_mb()` reports what this host can really back: host RAM **plus swap**
  minus the 2 GB reserve, capped at 16 GB — creating/starting a VM above it fails
  with a readable error. `GET /api/system` exposes `host_ram_mb`, `host_swap_mb`
  and `max_ram_mb`.
  - This sandbox has 8 GB of RAM, so the `swap` compose service creates
    `/data/swapfile` (default 11264 MB, override with `SWAP_MB`) and enables it
    once at startup — that is what makes a 16 GB VM startable here. `swapon`
    needs CAP_SYS_ADMIN, hence `privileged: true` on that one service; it serves
    nothing and mounts only `vm_data`. Remove the service (or set `SWAP_MB`) to
    trade VM RAM for disk — the swapfile costs its size on the same volume as the
    VM disks.
  - With swap the guest really can use all 16 GB, but pages beyond physical RAM
    are on disk: a 16 GB guest on this host is very slow and effectively runs on
    ~6 GB in RAM. Verify the backing store with
    `docker compose -f docker-compose.base44.yml exec -T api cat /proc/swaps`.
- **vTPM 2.0** (`enable_vtpm`): each guest gets its own `swtpm` process
  (`swtpm socket --tpm2 --terminate`, log `/data/tpm/<vm_id>/swtpm.log,level=3`),
  state in `/data/tpm/<vm_id>`, control socket `/tmp/swtpm-<vm_id>.sock`, wired to
  QEMU as `-chardev socket` + `-tpmdev emulator` + `tpm-crb` (q35) / `tpm-tis`
  (pc-i440fx). `swtpm` is installed in `backend/Dockerfile.base44`.
  - swtpm is a **tracked child** of the API worker, never `--daemon`: daemonizing
    reparents it to PID 1, whose exit is never reaped, so every cycle left a zombie.
  - `_start_swtpm()` calls `_stop_vtpm()` first, and a failed QEMU launch stops it
    too. Without that, a failed start leaked a second swtpm holding the same state
    directory — two backends on one TPM NVRAM, which is exactly what silently broke
    vTPM. The sweep in `_stop_vtpm()` finds leftovers by state dir *and* socket in
    `/proc` (the image has no `ps`), because `--terminate` only fires on a clean QEMU
    disconnect.
  - Verify: start a vTPM VM, then `grep -c SWTPM_IO /data/tpm/<id>/swtpm.log` must be
    non-zero (QEMU is exchanging TPM 2.0 commands) and exactly one `swtpm` process may
    reference that VM's state dir. `GET /api/system` → `vtpm_available`.
- **Secure Boot** (`secure_boot`, needs `enable_uefi`): Windows 11's Setup refuses to
  install without it, and plain `OVMF.fd` has no keys. This switches to the split
  SMM-enabled firmware — `-machine q35,smm=on`, read-only
  `/usr/share/OVMF/OVMF_CODE_4M.secboot.fd` as pflash unit 0, a **per-VM** copy of
  `/usr/share/OVMF/OVMF_VARS_4M.ms.fd` (Microsoft keys) in `/data/uefi/<vm_id>_VARS.fd`
  as unit 1, plus `-global driver=cfi.pflash01,property=secure,value=on`. Both firmware
  files must exist (`/api/system` → `secure_boot_available`); a start without the vars
  copy is created automatically, and a start with Secure Boot but no UEFI raises a
  readable error instead of silently dropping the feature.
- **Quick profiles** (`frontend/src/lib/vmProfiles.js`): one-click presets that fill
  real form fields — nothing hidden. The Windows 11 profile sets 4 vCPU / 8 GB /
  64 GB qcow2, `machine_type: q35`, UEFI + Secure Boot + vTPM 2.0, **SATA** disk and
  **e1000** NIC because Setup ships no VirtIO drivers (virtio would have no disk and no
  network until drivers are installed). Verify a profile VM starts by checking its QEMU
  command line for `q35,smm=on`, the `secboot` pflash drives, `tpm-crb` and
  `format=vhdx`/`vpc` for those disk formats.
- **Nested virtualization** (`nested_virt`): appends `,+vmx` to `-cpu`, so a guest
  can run its own hypervisor. Only meaningful with KVM — TCG cannot execute the
  nested VMX feature.
- **Direct kernel boot**: upload a kernel and initrd in the *Kernel Library*
  (`/kernels` page, `/api/kernels`), then pick them in the VM's Storage tab
  (`kernel_path`, `initrd_path`, `kernel_cmdline`). QEMU gets `-kernel` / `-initrd`
  / `-append` and skips firmware and bootloader. Files live in `/data/kernels`.
  A bad image fails fast with QEMU's own message (e.g. `invalid kernel header`).

## Extra storage: the 2 TB virtual drive

The `bigdisk` compose service provisions a **2 TB virtual hard drive** and makes it
usable from both the sandbox host and Docker containers.

- Backing store: `/data/bigdisk.img` — a sparse ext4 image on the `vm_data` volume,
  created with `truncate -s ${DRIVE_SIZE:-2T}` and formatted once with
  `mkfs.ext4 -E lazy_itable_init=1` (guarded by `blkid`, so restarts never reformat).
- It is loop-mounted (`losetup` + `mount -o noatime`) inside the privileged `bigdisk`
  container onto a **shared-propagation** bind of the host directory `/srv/bigdisk`,
  so the filesystem appears at `/srv/bigdisk` on the sandbox host and inside any
  container that bind-mounts that path (`-v /srv/bigdisk:/mnt/bigdisk:shared`).
- **2 TB is virtual, not free space.** The image grows as data is written, but every
  byte comes out of the sandbox's own disk (~19 GB free with the 12 GB swapfile and
  the ISOs in place). Writes to the drive fail at that point even though `df` still
  reports ~2 TB free. Check real headroom with `df -h /data` inside `api`.
- The mount check is `findmnt --target /mnt/bigdisk` looking for `/dev/loop*`, not
  `mountpoint`: the bind target is always a mount point, so `mountpoint` reports
  "already mounted" even when the loop filesystem is absent.
- The healthcheck fails unless the loop filesystem is mounted *and* its size is
  above 10^9 1K-blocks, so a plain bind with no drive is never reported healthy.
- The `api`/`web` containers do **not** mount it. Adding it means recreating `api`,
  which kills running guests (see "a reloaded worker re-adopts running guests" —
  only reloads survive). Mount `/srv/bigdisk` in a service when it actually needs
  the drive, and recreate that service deliberately.
- Verify:

```bash
docker compose -f docker-compose.base44.yml ps bigdisk            # healthy
df -h /srv/bigdisk                                                # /dev/loopN, 2.0T
docker run --rm -v /srv/bigdisk:/mnt/bigdisk:shared debian:12-slim \
  sh -c 'echo ok > /mnt/bigdisk/x && cat /mnt/bigdisk/x'          # ok
```

## Docker tab

`/docker` (`components/DockerManager.jsx`, `/api/docker/*`) lists the host's
containers and images and starts/stops/restarts containers or shows their logs.

- The API talks to the Docker Engine's HTTP API over the Unix socket with
  `httpx.AsyncHTTPTransport(uds=…)` (`services/docker_service.py`) — no docker CLI
  in the image. The socket is bind-mounted by **both** compose files; without it
  `/api/docker/status` returns `available: false` and the tab explains how to mount
  it. `DOCKER_SOCKET` overrides the path.
- The API version prefix is negotiated once from `/version`.
- Containers are **protected** when they belong to the API container's own compose
  project (matched through the container's hostname = its Docker id): stopping them
  would kill the app, so the UI disables their actions and the API returns 400.
- Logs are demultiplexed from Docker's 8-byte frame headers (non-TTY containers).
- The socket grants full Docker control to the app: it is a trust boundary, not a
  read-only view. Keep it out of untrusted deployments.

## VM import / export

`/api/vms/{id}/export` streams a `.tar.gz` (`manifest.json` + optional `disk.<fmt>`),
`POST /api/vms/import` (multipart `file`, optional `name`) creates a new VM from it
(`routers/vm_transfer.py`).

- Export is refused while QEMU is running for that VM (`qemu.is_running`); the tar is
  produced by `tar -czhf -` on a temp dir in `/data/exports` holding the manifest and a
  symlink to the disk, so nothing is copied and no extra disk space is used.
- Import writes the upload to `/data/imports`, reads `manifest.json`, streams the disk
  member to `/data/disks/<new-id>.<fmt>` and cleans up in `finally` (including on a
  bad archive, which returns 400). It always assigns a fresh id, stops the VM, clears
  runtime state, uniquifies the name (`Name (2)`), and drops `iso_path` / `kernel_path`
  / `initrd_path` references whose files are not present on this host.
- Metadata-only exports are valid: the imported VM gets a disk path and QEMU creates
  the empty image on first start.
- Smoke test (uses a throwaway VM; clean up the record *and* `/data/disks/<id>.<fmt>`
  because deleting a VM does not delete its disk):

```bash
VM=$(curl -s -X POST localhost:3000/api/vms -H 'Content-Type: application/json' \
  -d '{"name":"t","ram_mb":512,"disk_size_gb":1,"cpu_cores":1}')
ID=$(echo "$VM" | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
curl -s -o /tmp/vm.tar.gz "localhost:3000/api/vms/$ID/export?include_disk=false"
curl -s -F "file=@/tmp/vm.tar.gz" localhost:3000/api/vms/import
```

## AI assistant

`/api/ai/*` plus the floating panel in the UI (`components/AIAssistant.jsx`). The
backend (`services/ai_service.py`) calls any OpenAI-compatible
`/chat/completions` endpoint and gives the model tools it executes against the
live hypervisor: `system_info`, `list_vms`, `get_vm`, `list_isos`, `start_vm`,
`stop_vm`, `reset_vm`, `set_vm_power` (pause/resume). Destructive operations
(deleting VMs/ISOs/snapshots) are deliberately not exposed.

- Credentials: `OPENAI_API_KEY` (required, delivered as a Base44 secret through
  `env_file: /run/base44/app.env`), `OPENAI_BASE_URL` (default
  `https://api.openai.com/v1`, so Groq/OpenRouter/Ollama work too), `OPENAI_MODEL`
  (default `gpt-4o-mini`).
- Without a key the API returns 503 with a readable message and the panel shows
  a "Not configured" notice — the rest of the app is unaffected.
- Smoke test: `curl -s localhost:8000/api/ai/status` →
  `{"configured":false,"model":"gpt-4o-mini"}`; `POST /api/ai/chat` with
  `{"messages":[{"role":"user","content":"..."}]}` once the key is present.
