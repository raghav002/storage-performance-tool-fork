# SPT dashboard frontend

React UI using Mantine, Tailwind CSS, Apache ECharts, and TanStack Query. The production output is a single `../server/index.html`, embedded by the shared Go server.

## Build

From the repository root:

```sh
cd cli/internal/dashboard/frontend
npm ci
npm run build
```

The build checks TypeScript, bundles React and CSS locally, then embeds the bundles into `../server/index.html`. There are no runtime CDN dependencies. Commit the source and the generated `../server/index.html` together; CI fails if they differ.

## Run with the backend

Rebuild the Go executable after updating the HTML, because `go:embed` captures it at build time:

```sh
cd cli
go run . dashboard
```

Open `http://127.0.0.1:8000` directly or through an SSH tunnel. See `../README.md` for server setup.

For source development, `npm run dev` uses Vite on port 5173 and proxies reads to the backend on port 8000. **Live run submission requires the production Go server origin**; its same-origin check intentionally rejects cross-port requests. Use the built dashboard at port 8000 for actual runs.

## Code structure

`src/App.tsx` chooses which screen and run to show. It uses React state to switch screens, and TanStack Router has not been added. The `pages/` folder contains screens and their own components, while `components/` contains UI used by several screens. Its `layout/` folder contains the sidebar, header, and footer.

The `api/` folder contains server requests and TanStack Query code, while shared chart settings live in `charts/echarts.ts`. The main `types.ts` file describes shared data, and `pages/types.ts` lists screen names. These folders and files are under `src/`.

## Theme

The theme is split into four files, with `theme/index.ts` putting it together and `theme/tokens.ts` storing shared colors and values. `theme/components.ts` sets how Mantine components look, while `theme/cssVariables.ts` makes theme values available to CSS.

## Styling

Use Mantine for buttons, inputs, tables, and their appearance. Use Tailwind for layout, spacing, and custom containers. Reuse shared theme values when they fit, and use regular Tailwind classes when they match the value you need. Keep custom `rem` values when needed, and use CSS modules only when Tailwind cannot handle the styling cleanly.

Mantine provides the base styles, so Tailwind Preflight is turned off. `styles.css` connects Tailwind to the theme, and it reduces animation when the user requests it.

## Checks

Run `npm run lint`, `npm run format:check`, and `npm run typecheck` to check the code. Run `npm test` for tests and `npm run build` to build the dashboard. Use `npm run format` to fix formatting. Run these commands from the frontend folder, and commit UI changes together with the rebuilt `../server/index.html`.

## Data and controls

- GET `/api/state`, refreshed every two seconds; a visible error identifies stale state and disables run submission. It also carries `limits`, the values each run mode accepts.
- POST `/api/runs`, after review, with a run `mode` (`guided` or `expert`) plus four options: object count, object size, threads, and runtime limit.
- Guided mode offers the preset choices; Expert mode accepts any values inside the server's ranges. `src/utils/validation.ts` mirrors the server's rules for inline feedback only — the server validates every request again.
- Final phase averages remain separate from genuine interval history.
- Shared chart window offers fit, zoom, minute/hour/day presets, pan, latest following, synchronized inspection, and exact visible-window CSV export.
- Zero measurements remain zero. Unreported values remain unavailable. No sample values appear as live results.
- Performance limits retain the old browser-storage key, scoped by target/bucket/object size/threads.
- Full measurements remain available in expandable SPT details and exports.
