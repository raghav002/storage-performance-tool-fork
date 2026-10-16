# SPT dashboard frontend

React UI adapted from the project branch identified in `UPSTREAM.md`. The production output is a single `dashboard/index.html`, embedded by the Go server in `dashboard/`.

## Build

From the repository root:

```sh
cd dashboard/frontend
npm ci
npm run build
```

The build checks TypeScript, bundles React and CSS locally, then embeds the bundles into `../index.html`. There are no runtime CDN dependencies. Commit the source and the generated `dashboard/index.html` together; CI fails if they differ.

## Run with the backend

Rebuild the Go executable after updating the HTML, because `go:embed` captures it at build time:

```sh
cd dashboard
go build -o spt-dashboard .
./spt-dashboard
```

Open `http://127.0.0.1:8000` directly or through an SSH tunnel. See `../README.md` for server setup.

For source development, `npm run dev` uses Vite on port 5173 and proxies reads to the backend on port 8000. **Live run submission requires the production Go server origin**; its same-origin check intentionally rejects cross-port requests. Use the built dashboard at port 8000 for actual runs.

## Data and controls

- GET `/api/state`, refreshed every two seconds; a visible error identifies stale state and disables run submission. It also carries `limits`, the values each run mode accepts.
- POST `/api/runs`, after review, with a run `mode` (`guided` or `expert`) plus four options: object count, object size, threads, and runtime limit.
- Guided mode offers the preset choices; Expert mode accepts any values inside the server's ranges. `src/utils/validation.ts` mirrors the server's rules for inline feedback only — the server validates every request again.
- Final phase averages remain separate from genuine interval history.
- Shared chart window offers fit, zoom, minute/hour/day presets, pan, latest following, synchronized inspection, and exact visible-window CSV export.
- Zero measurements remain zero. Unreported values remain unavailable. No sample values appear as live results.
- Performance limits retain the old browser-storage key, scoped by target/bucket/object size/threads.
- Full measurements remain available in expandable SPT details and exports.
