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

The frontend build writes the self-contained page to `dashboard/index.html`, which the Go server embeds at compile time. Rebuild the Go executable after changing the UI.

## Run

Run the server on a host where SPT is installed and configured:

```sh
./spt-dashboard
```

It listens on `127.0.0.1:8000` by default. For remote access, use SSH port forwarding and keep the server bound to loopback. Do not expose this service directly to the public internet. SPT's storage target and credentials must be configured on the host; the dashboard does not accept credentials from the browser.

The dashboard enforces bounded workload choices and allows one dashboard-managed run at a time. Run results are stored on the host in SPT's results directory.
