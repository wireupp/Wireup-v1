# Vercel services deployment

The Vercel project contains two public-facing services:

- `app`: the Vite frontend, routed at `/(.*)` after more specific routes.
- `backend`: the FastAPI API, routed at `/api/(.*)`.

Both services use the repository root. The backend entrypoint is `backend/vercel_app.py`, and the root `requirements.txt` includes `backend/requirements-vercel.txt` (runtime deps only; local development still uses `backend/requirements.txt`, which adds `uvicorn` and `pytest`). This preserves the `backend` Python package and repository-relative paths instead of flattening backend files into the function root. The backend function explicitly includes its catalog, example templates, and shared component metadata.

Python functions on Vercel bundle every project file reachable from the service root unless excluded. Because the backend service root is the repository root, the frontend `node_modules` tree and the full `vendor/` tree would otherwise be packaged into the same Lambda and exceed the 500 MB limit. `vercel.json` uses `excludeFiles` on `backend/vercel_app.py` to drop frontend assets, tests, docs, and vendored simulator sources, while `includeFiles` keeps the small backend data files the API needs at runtime.

The browser already uses same-origin `/api/...` HTTP URLs and derives its hardware runtime WebSocket from the same origin, so no build-time frontend service URL is required.

## External remote simulation

`remote-simulation` remains an external, private service deployed with `deployment/remote-simulation/Dockerfile`. It is not a Vercel service because it requires native QEMU binaries, persistent subprocesses, in-memory sessions, and one long-lived worker.

Configure these variables in the Vercel backend runtime:

- `WIREUP_DEPLOYMENT=preview` for Vercel Preview deployments, or `production` for the eventual production deployment; both enable hosted security rules.
- `WIREUP_ACCESS_TOKEN`: a strong private preview password; keep it server-only.
- `WIREUP_ALLOWED_ORIGINS`: the exact deployed frontend origin, such as `https://your-preview-domain.vercel.app`; Vercel's `VERCEL_URL`, `VERCEL_BRANCH_URL`, and `VERCEL_PROJECT_PRODUCTION_URL` are accepted automatically.
- `WIREUP_PUBLIC_HEALTH=true`: keeps the health endpoint available for deployment checks.
- `REMOTE_SIMULATION_URL`: the external gateway's HTTPS base URL.
- `REMOTE_SIMULATION_TOKEN`: the same secret of at least 32 printable non-whitespace ASCII characters configured on the gateway.

`REMOTE_SIMULATION_URL` is not a Vercel service binding in this topology because service bindings can only target another service in the same Vercel project. Never expose either variable through a `VITE_` variable or send the gateway token to the browser.

## Project storage

On Vercel, the backend writes project files to `/tmp/wireup-hardware` instead of the read-only deployment bundle. Set `WIREUP_DATA_DIR` to override the location on a persistent host. Vercel temporary storage is instance-local and disposable, so projects can disappear or differ between function instances; production hosting requires a durable database or object store.

## Runtime limitations

The existing backend was designed for a persistent local/container host. A Vercel deployment still needs platform-compatible replacements for these features before they can be considered production-ready:

- durable project and artifact persistence is not yet available on Vercel;
- browser simulation coordination uses a persistent WebSocket and process-local maps;
- firmware compilation launches Arduino CLI and requires installed board toolchains;
- classic ESP32 local simulation uses a Windows QEMU DLL and child process;
- physical board discovery and flashing require access to the user's local USB/serial devices;
- production authentication requires a browser-compatible identity and authorization flow.

The Vercel configuration establishes service builds and public routing. It does not make those stateful or native capabilities serverless-compatible.

## Local validation

Use `vercel dev` to run the configured Vercel services together. Continue using `npm run dev` for the repository's existing Vite proxy development workflow.
