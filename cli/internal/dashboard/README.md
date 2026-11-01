# SPT Dashboard

A small Go web server with an embedded React dashboard for running a bounded SPT write/verify workload and reviewing its metrics.

## Build

Requirements: Go 1.25+, Node.js 22.6+, and npm.

```sh
cd cli/internal/dashboard/frontend
npm ci
npm run build
cd ../../../
go test ./internal/dashboard/...
go build .
```

The frontend build writes the self-contained page to `cli/internal/dashboard/server/index.html`, which the Go server embeds at compile time. Rebuild SPT after changing the UI.

## Run

From the SPT CLI:

```sh
spt dashboard
```

This starts the dashboard, prints its local URL, and opens a browser. Keep the terminal open while using the dashboard. Closing the browser leaves the server and any active run running. Ctrl+C stops the server and interrupts an active benchmark.

The dashboard starts its own headless `write-verify` subprocess using the same SPT executable that launched it. Run `spt dashboard --help` for command options. `--config path/to/dashboard.json` selects deployment branding and workload limits; `DASHBOARD_CONFIG` provides the default.

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

To choose the browser, set `BROWSER` (the first entry of a colon-separated list is run directly, with the URL as its argument, or in place of `%s`). `--no-browser` takes precedence; without it, `BROWSER=true` also opens nothing.

The server listens on `127.0.0.1:8000` by default. For remote access, use SSH port forwarding and keep the server bound to loopback. SPT's storage target and credentials must be configured on the host; the dashboard does not accept credentials from the browser.

The dashboard enforces bounded workload choices and allows one dashboard-managed run at a time. Run results are stored on the host in SPT's results directory.

### Saved history and console logs

The dashboard retains the newest live measurements within both a 1,500-sample limit and a 4,000,000-byte JSON limit. It reloads usable saved rows after a restart without duplicating the last measurement. Damaged rows are skipped; malformed or oversized snapshot files are ignored. If a history save fails, measurements remain available in memory and saving is retried on later polls, including polls with no new measurements. History saving is best-effort and depends on the state directory remaining writable.

Each dashboard console log keeps the first 2,000,000 bytes. Output beyond that limit is consumed without being stored, so a full log does not block SPT from finishing. New logs, latest-job state, and per-run outcome records use owner-only file permissions on Unix.

## Monitor an existing SPT run

Use **Connect to active run** to monitor a run started separately with the SPT CLI. Choose its entry machine from the client machines saved under Storage configuration. The dashboard reads the documented SPT `GET /status` and `GET /metrics/json` APIs on port `9999`, refreshes them while attached, and keeps a bounded sample history for the charts. The connection is read only: it does not launch or stop an SPT process. If SPT is not running or its API cannot be reached, the page shows the endpoint error and offers a retry. Disconnect returns the dashboard to its local state.

The entry machine must already be listed in Storage configuration, which limits API requests to the selected SPT hosts. For a local run, use `127.0.0.1` as the client machine; for a remote VM, choose the configured entry host and keep dashboard access on the SSH tunnel.

## Run modes

The Guided/Expert switch in the top bar selects how the workload step is configured:

| Setting | Guided (presets) | Expert (any value in range) |
|---|---|---|
| Objects | 10, 25, 50, 100, 250, 320 | 1–100,000 |
| Object size | 64KiB, 256KiB, 1MiB, 4MiB, 16MiB | 1KiB–1GiB, whole KiB/MiB/GiB |
| Threads | 1, 2 | 1–64 |
| Runtime limit | 60, 120, 300, 600 s | 10–3600 s |
| Total test data | — | at most 100 GiB (objects × size) |

Defaults preserve the reviewed Capstone VM profile. Deployment-specific limits can be overridden with a JSON settings file; the server publishes the effective values in `/api/state` and validates every run request against them. Object sizes must match `<number><KiB|MiB|GiB>` exactly, so a value can never be passed to SPT as an option.

The settings file supports `branding.product_name`, `branding.environment_label`, and a `limits` object. The `limits.guided` object accepts arrays named `object_counts`, `object_sizes`, `threads`, and `max_runtime_seconds`. `limits.expert` accepts `object_count_min`, `object_count_max`, `object_size_bytes_min`, `object_size_bytes_max`, `threads_min`, `threads_max`, `max_runtime_seconds_min`, `max_runtime_seconds_max`, and `max_total_bytes`. Any omitted fields keep their defaults.

## Storage configuration

The app opens on **Configure run**, which has two steps. Workload settings stay locked until the storage step has been verified, and the server refuses to start a run without a passing verification.

- **Client machines**: the machines that generate load, entered as `host` or `user@host` (up to 8; `127.0.0.1` is the dashboard host). They are passed to SPT as `--test-hosts`, and the first one is the entry node. Each remote machine needs Docker and key-based SSH access from the dashboard host; passwords are not supported.
- **S3 endpoint** (optional): overrides the endpoint from `.env`. HTTP and HTTPS URLs are supported; use HTTPS outside a trusted private network. The bucket and access keys always come from `.env`.
- **Verify connection** saves these settings, calls SPT's typed verification API for the client machines, and checks that the endpoint answers HTTP(S) from the dashboard host. The endpoint check proves reachability only, not credentials or bucket access.

Changing the client machines or the endpoint requires verifying again. Verification and runs never overlap, because both start SPT containers on the same ports. Settings and the last job are kept in the dashboard state directory under the user configuration location.
