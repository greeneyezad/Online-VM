# Working on this repo (Base44 sandbox notes)

## Run it

```bash
docker compose -f docker-compose.base44.yml up -d --build
docker compose -f docker-compose.base44.yml ps
docker compose -f docker-compose.base44.yml logs -f web api
```

- `web` (Vite dev server) is the only public entry point: host port **3000**.
- `api` (FastAPI/uvicorn `--reload`) is **not** published; the browser reaches it
  through the Vite dev-server proxy. `vite.config.js` reads `BACKEND_ORIGIN`
  (default `http://localhost:8000` for plain local dev, `http://api:8000` in compose)
  and proxies `/api` and `/ws`.
- No external services or credentials are needed. Nothing is stored in a database:
  VM records live in `/data/vms.json` plus `/data/disks` and `/data/isos`
  (the `vm_data` compose volume).

## Things that are easy to trip over

- **No `/dev/kvm` in this sandbox.** The backend image ships qemu (`qemu-system-x86`,
  `qemu-utils`, `ovmf`), so creating/deleting VMs and uploading ISOs work, but a VM
  created with the defaults (`enable_kvm: true`, `cpu_model: "host"`) fails to start
  with a KVM error. Turn KVM off and pick a non-`host` CPU model (e.g. EPYC) to run
  under TCG emulation — it boots, just very slowly. This is a host capability limit,
  not an app bug.

- **Python dependencies are installed by the container command**
  (`pip install -r requirements.txt`, cached) at every start. After editing
  `backend/requirements.txt`, restart the api service; otherwise uvicorn's reloader
  picks up source edits on its own (`WATCHFILES_FORCE_POLLING=true`).

- **Frontend deps** live in the `web_node_modules` named volume and are installed
  with `npm install` on start (the repo has no `package-lock.json`). Changing
  `package.json` → `docker compose -f docker-compose.base44.yml restart web`.

- **Vite host check**: the preview proxy rewrites the `Host` header and the browser
  sends a public `Origin`. `vite.config.js` allow-lists
  `.${BASE44_SANDBOX_HOST_DOMAIN}` and `${BASE44_PUBLIC_HOST_SUFFIX}` **only** when
  `BASE44_PREVIEW_MODE === "1"`; with the flag unset, Vite's default host check
  applies unchanged.

- **The VNC console builds a `ws://` URL** in `frontend/src/components/VMConsole.jsx`;
  browsers block that from an `https://` preview. Only relevant once a VM actually
  runs (see the KVM note above).

## Verify

```bash
curl -s localhost:3000/                     # Vite dev HTML (unhashed /src/main.jsx)
curl -s localhost:3000/api/vms              # API through the dev-server proxy
docker compose -f docker-compose.base44.yml exec -T api curl -s localhost:8000/health
```

There is no test suite, linter or auth in this app.
