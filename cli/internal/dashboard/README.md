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

The dashboard runs the same SPT executable that launched it. `spt dashboard --port 8000` sets the local port; `--config path/to/dashboard.json` selects deployment branding and workload limits. `DASHBOARD_PORT` and `DASHBOARD_CONFIG` provide environment-variable defaults. The older root flag `spt --dashboard` remains available for compatibility.

CLI mode reads `.env` from the SPT executable directory and your home directory, with environment variables taking precedence. State is stored under your user configuration directory in `spt/dashboard` (`~/.config/spt/dashboard` on Linux). Results remain in `~/results`.

`DASHBOARD_PORT` selects the local port, default 8000. Set it to `0` to choose a free port automatically. If a browser cannot be opened, use the printed URL. Over SSH, forward that port to your local machine.

To choose the browser, set `BROWSER` (the first entry of a colon-separated list is run directly, with the URL as its argument, or in place of `%s`). On a headless host, `BROWSER=true` opens nothing. A `--no-browser` flag for the same purpose is proposed in PR #12 (Alex); it is not on this branch, and `BROWSER` keeps working alongside it.

The server listens on `127.0.0.1:8000` by default. For remote access, use SSH port forwarding and keep the server bound to loopback. SPT's storage target and credentials must be configured on the host; the dashboard does not accept credentials from the browser.

The dashboard enforces bounded workload choices and allows one dashboard-managed run at a time. Run results are stored on the host in SPT's results directory.

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
