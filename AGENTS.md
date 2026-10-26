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
   production compose does): the sandbox has no `/dev/kvm`. Consequence: creating,
   listing and deleting VMs works, but **starting** a VM fails, because VMs default to
   `-machine q35,accel=kvm` and the VNC console then has nothing to connect to. This is
   an environment limitation, not an app bug — don't "fix" it by changing app code.
   Creating a VM with KVM disabled (`enable_kvm: false`) still needs a QEMU-capable
   host to actually boot a guest.
4. `VMConsole` builds its WebSocket URL as `ws://<current host>:<port>/ws/vnc/<id>`. Over
   the proxied HTTPS preview URL that would be a mixed-content `ws://` connection, so
   the VNC console is not usable through the preview proxy even with a running VM.

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
