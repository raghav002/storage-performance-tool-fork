# SPT Dashboard

A small Go web server with an embedded React dashboard for running a bounded SPT write/verify workload and reviewing its metrics.

## Build

Requirements: Go 1.25+, Node.js 22.6+, and npm.

```sh
cd frontend
npm ci
npm run build
cd ..
go test ./...
go build -o spt-dashboard .
```

The frontend build writes the self-contained page to `dashboard/server/index.html`, which the Go server embeds at compile time. Rebuild the Go executable after changing the UI.

## Run

From the SPT CLI:

```sh
spt dashboard
```

This starts the dashboard, prints its local URL, and opens a browser. Keep the terminal open while using the dashboard. Closing the browser leaves the server and any active run running. Ctrl+C stops the server and interrupts an active run or verification, waiting for the CLI to finish its cleanup.

The dashboard starts its own headless `write-verify` subprocess using the same SPT executable. Run `spt dashboard --help` for command options.

CLI mode reads `.env` from the directory where you launch SPT and from your home directory, with environment variables taking precedence. State is stored under your user configuration directory in `spt/dashboard` (`~/.config/spt/dashboard` on Linux). Results remain in `~/results`.

The server listens only on localhost. `--port` overrides `DASHBOARD_PORT`; the default is 8000. Set the port to `0` to choose a free port automatically:

```sh
spt dashboard --port 9000
```

On a server without a desktop, skip opening the browser:

```sh
spt dashboard --no-browser
```

For SSH access, forward the dashboard port from your local machine:

```sh
ssh -L 8000:127.0.0.1:8000 user@server
```

Run `spt dashboard --no-browser` on the server, then open `http://localhost:8000` in your local browser. If you choose another dashboard port, update the forwarding command to match. If browser opening fails during a local run, use the printed URL.

Run the server on a host where SPT is installed and configured:

```sh
./spt-dashboard
```

The standalone launcher uses the same server package and retains its executable-directory `.env` and `.dashboard-state/` locations.

It listens on `127.0.0.1:8000` by default. For remote access, use SSH port forwarding and keep the server bound to loopback. Do not expose this service directly to the public internet. SPT's storage target and credentials must be configured on the host; the dashboard does not accept credentials from the browser.

The dashboard enforces bounded workload choices and allows one dashboard-managed run at a time. Run results are stored on the host in SPT's results directory.

## Run modes

The Guided/Expert switch in the top bar selects how the workload step is configured:

| Setting | Guided (presets) | Expert (any value in range) |
|---|---|---|
| Objects | 10, 25, 50, 100, 250, 320 | 1–100,000 |
| Object size | 64KiB, 256KiB, 1MiB, 4MiB, 16MiB | 1KiB–1GiB, whole KiB/MiB/GiB |
| Threads | 1, 2 | 1–64 |
| Runtime limit | 60, 120, 300, 600 s | 10–3600 s |
| Total test data | — | at most 100 GiB (objects × size) |

The limits are constants in `server/app.go`. The server publishes them in `/api/state` as `limits`, and it validates every `POST /api/runs` against the requested mode, whatever the browser sends. The browser repeats the same checks for inline feedback. Object sizes must match `<number><KiB|MiB|GiB>` exactly, so a value can never be passed to SPT as an option.

## Storage configuration

The app opens on **Configure run**, which has two steps. Workload settings stay locked until the storage step has been verified, and the server refuses to start a run without a passing verification.

- **Client machines**: the machines that generate load, entered as `host` or `user@host` (up to 8; `127.0.0.1` is the dashboard host). They are passed to SPT as `--test-hosts`, and the first one is the entry node. Each remote machine needs Docker and key-based SSH access from the dashboard host; passwords are not supported.
- **S3 endpoint** (optional): overrides the endpoint from `.env`. It must be an HTTPS URL. The bucket and access keys always come from `.env`.
- **Verify connection** saves these settings, runs `spt verify` against the client machines, and checks that the endpoint answers HTTPS from the dashboard host. The endpoint check proves reachability only, not credentials or bucket access.

Changing the client machines or the endpoint requires verifying again. Verification and runs never overlap, because both start SPT containers on the same ports. Settings, the last job, and `verify.log` are kept in the dashboard state directory: the user configuration location for CLI mode, or `.dashboard-state/` beside the standalone executable.
