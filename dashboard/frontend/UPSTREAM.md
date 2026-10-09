# Dashboard UI provenance

Adapted from [Dell Technologies Storage Performance Tool frontend](https://github.com/raghav002/storage-performance-tool-fork/tree/feature/shinymidori/frontend-dashboard).

- Branch: `feature/shinymidori/frontend-dashboard`
- Inspected commit: `f7c4d1e194dc986f6fc41472b5508c7f4d0fde74`
- License: MIT; original copyright and terms retained in `LICENSE`.
- Reused: light sidebar/workspace shell, style sheet, metric cards, chart presentation, Guided/Expert selection pattern.
- Changed: data model and requests now use this project's `/api/state` and `/api/runs`; configuration matches the Go server's accepted bounded write/verify settings. Charts preserve missing values, isolated measurements, phase separation, and shared time windows. No upstream mock-data service is included.

The upstream frontend targets a different API contract and exposes additional operations. Those operations require backend work before they can become functional here.
