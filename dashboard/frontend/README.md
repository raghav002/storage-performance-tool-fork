# SPT dashboard frontend

React UI adapted from the project branch identified in `UPSTREAM.md`. The production output is a single root `index.html`, embedded by the existing Go server. The old UI is preserved at `../backups/index-before-branch-ui-20261006.html`. `../demo.html` is unchanged.

## Build

```sh
cd /Users/harshitgoyal/Desktop/projects/Dell/frontend
npm ci
npm run build
```

The build checks TypeScript, bundles React and CSS locally, then embeds the bundles into `../index.html`. There are no runtime CDN dependencies. Commit the source and generated root HTML together.

## Run with the existing backend

Rebuild the Go executable after updating the HTML because `go:embed` captures it at build time:

```sh
cd /Users/harshitgoyal/Desktop/projects/Dell
go build -o spt-dashboard .
./spt-dashboard
```

Open `http://127.0.0.1:8000` or the existing SSH tunnel. See `../LIVE_DASHBOARD.md` for server setup. The current build was deployed to the VM on October 6, 2026. Double-click `../start-dashboard.command` to reconnect later.

For source development, `npm run dev` uses Vite on port 5173 and proxies reads to the backend on port 8000. **Live run submission requires the production Go server origin**; its same-origin check intentionally rejects cross-port requests. Use the built dashboard at port 8000 for actual runs.

## Data and controls

- GET `/api/state`, refreshed every two seconds; a visible error identifies stale state and disables run submission.
- POST `/api/runs`, after review, with exactly four accepted options: object count, object size, threads, and runtime limit.
- Final phase averages remain separate from genuine interval history.
- Shared chart window offers fit, zoom, minute/hour/day presets, pan, latest following, synchronized inspection, and exact visible-window CSV export.
- Zero measurements remain zero. Unreported values remain unavailable. No sample values appear as live results.
- Performance limits retain the old browser-storage key, scoped by target/bucket/object size/threads.
- Full measurements remain available in expandable SPT details and exports.

## Change scope

The UI uses the existing API and run bounds. The backend has a small recovery fix to restore completed-job settings and status after restart. Server credentials/configuration are unchanged. The new UI was rebuilt into the deployed Go executable. The connected dashboard loaded saved VM measurements; no new SPT run was launched during this migration or setup, and backend/integration tests were not run.
