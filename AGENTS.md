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

## No credentials required

The app uses no external services and no database — the backend persists to
`/data/vms.json`. There are no secrets to configure.

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
3. The dev compose does **not** grant `privileged: true` or pass `/dev/kvm` (the
   production compose does): the sandbox has no `/dev/kvm`. QEMU therefore runs with
   `-accel tcg` (software emulation) instead of KVM — guests really boot and are
   usable, just slowly. `qemu_service.kvm_available()` decides this per host, so a
   machine with `/dev/kvm` still gets hardware acceleration with no config change.
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
  `qemu_service.kvm_available()` chooses the accelerator: with `/dev/kvm` it uses
  `accel=kvm` + `-cpu host`; without it, `-accel tcg,thread=multi` and `host` is mapped
  to `max`. Guests boot either way — TCG is just slow.
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
- **Editing backend files orphans running guests.** `uvicorn --reload` replaces the
  worker, and the `running_vms` registry is in memory, so QEMU processes keep running
  (and keep their VNC port) with nothing tracking them. Kill them before starting VMs
  again:
  `for p in /proc/[0-9]*; do c=$(cat $p/comm 2>/dev/null); case "$c" in qemu-system*) kill ${p#/proc/};; esac; done`
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
