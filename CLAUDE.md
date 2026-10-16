# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository overview

Dell Storage Performance Tool (SPT): a benchmark suite for S3-compatible storage. This repo is a fork of `dell/storage-performance-tool`. It holds three components:

- `cli/`: Go CLI/TUI that builds the `spt` binary (Cobra commands in `cli/cmd`, Bubble Tea TUI in `cli/tui`, logic in `cli/internal/*`).
- `engine/`: Java 21 benchmarking engine (Gradle multi-project). It builds `spt.jar` plus extension JARs and a Docker image.
- `dashboard/`: a fork-only addition that upstream does not have. It is a small Go web server (`dashboard/main.go`, module `dell-dashboard`) that embeds a React/Vite UI and shells out to `spt`.

`go.work` ties together `cli`, `cli/tools/codehealth/deadfinder`, and `dashboard`. The root `VERSION` file is the single version source that both the CLI and engine builds read (`scripts/release/check_version_sync.sh` checks it).

## Commands

Root (orchestrates both main components): `make setup`, `make build`, `make test`, `make lint`, plus per-component variants `make build-cli`, `make test-engine`, `make lint-engine`, and so on.

### CLI (`cli/`)
```bash
make -C cli build          # builds ./cli/spt with buildinfo ldflags (version from ../VERSION; non-tag builds are "-dev+<sha>")
make -C cli test           # full suite with summary (tools/test_summary.sh)
make -C cli test-quick     # plain `go test ./...`
make -C cli lint           # golangci-lint >= 2.2.0; prod code full set, tests "unused" only. LINT_STRICT=1 re-enables cyclop/nestif/dupl
make -C cli ci-local       # tidy/fmt/vet/build/lint/compile-tests; LOCAL_CI_RUN_TESTS=1 also runs tests
make -C cli install-hooks  # pre-commit: gofmt -s + golangci-lint on staged files
cd cli && go test ./internal/scenario -run TestName   # single test
```
CI (`.github/workflows/ci.yml`) requires `gofmt -l` to be clean, `go vet`, and **at least 65% total coverage** across `cli/` packages. It also runs gosec (some excludes) and code-sanitizer. Mark justified gosec exceptions with `// #nosec Gxxx -- reason`.

### Engine (`engine/`)
Gradle Wrapper is the official tool; the Makefile only wraps it.
```bash
cd engine
./gradlew build shadowJar                    # dist in bundle/build/dist (spt.jar + ext/)
./gradlew test                               # unit tests
./gradlew test --tests "com.dell.spt.base.SomeTest"   # single test class
./gradlew :core:spt-base:test --tests "..."           # single module
./gradlew spotlessCheck / spotlessApply      # Eclipse formatter: tabs, 120 cols
make errorprone                              # Error Prone (CI-gated on core:spt-base)
make quick                                   # bundle build without tests or spotless
make docker-local                            # builds ghcr.io/dell/storage-performance-tool:spt_dev
```
Other test sets: `testIntegration`, `testPerformance`, `testAll`. Engine commits use conventional-commit prefixes (`feat:`, `fix:`, and so on).

### Dashboard (`dashboard/`)
```bash
cd dashboard/frontend && npm ci && npm run build   # tsc + vite + scripts/inline.mjs -> writes ../index.html
cd dashboard && go test ./... && go build -o spt-dashboard .
```
`dashboard/index.html` is a **generated, committed** single-file bundle that the Go binary embeds with `//go:embed`. After any change under `frontend/src`, rebuild it and commit it with the source: CI fails on `git diff --exit-code -- dashboard/index.html`. `npm run dev` (Vite on port 5173) can only read state. Run submission needs the Go server's same-origin port (8000).

## Architecture

### How the CLI drives the engine
1. `cli/cmd/run.go` and its `run_*.go` siblings parse flags and `.env` defaults. `.env` comes from `$HOME/.env` and `./.env` (`cmd/envdefaults.go`, `internal/config`). Validation lives in `cmd/validation.go`, and workload names come from `internal/workload/registry.go`.
2. `internal/scenario` turns the parameters into an engine **JS scenario plus YAML defaults** (`generator*.go` and `templates*.go`, with separate generators for mixed, integrity, tables, and delete). The CLI never hand-writes engine flags. Changes to engine-facing behaviour usually happen here.
3. The CLI launches the engine as a **Docker container**, locally or over SSH on each host in `HOSTS`/`--test-hosts` (`tui/docker*.go`, `tui/remote_docker.go`, `internal/docker`). The first host is the entry node, and the others are workers connected through RMI (port 1099, plus 40000+ object ports).
4. `tui/spt_api.go` talks to the engine REST API on port **9999**: POST `/run`, status, and JSON metrics. Submission is deliberately non-idempotent. Ambiguous submissions (`AmbiguousSubmissionError`) must never be retried blindly, and destructive actions require proven run ownership.
5. `tui/orchestrator*.go` (single and multi-host) polls metrics, aggregates them (`metrics_aggregator.go`), and drives either the TUI (`model.go`, `liveview.go`) or headless mode (`tui/headless/runner.go`). Headless mode turns on automatically without a TTY.
6. After a run, `internal/results` fetches and finalizes artifacts. `internal/integrity` stages durable manifests for write-verify/read-verify. `internal/engineinfo` collects engine build identity and enforces version-consistency gates.

Engine image selection: release CLI builds use `ghcr.io/dell/storage-performance-tool:v<cli-version>`. Dev builds (any non-tag build) use the **local-only** `:spt_dev` tag, which is never pulled, so build it with `make -C engine docker-local`. `--spt-image` or `SPT_IMAGE` overrides the choice. Nothing falls back to `latest`.

### Engine layout
- `core/spt-base`: the engine core (`com.dell.spt.base`): load generation, items, metrics, the REST control API (`control`, `svc`), config, and integrity.
- `extensions/load-steps/{pipeline,weighted,mixed}` and `extensions/storage-drivers/{primitives,protocols,implementations}`. The implementations are `s3` (Netty, default), `s3-aws`, `s3-rdma` (native CMake lib), `s3-tables`, `swift`, and `atmos`. Extensions load from `ext/` next to `spt.jar`.
- `bundle`: assembles the distribution and Docker image. `buildSrc` generates engine build-info metadata.

### Dashboard
`dashboard/main.go` serves `/api/state` and `/api/runs`. It runs exactly one bounded `spt run write-verify --headless ...` at a time. Runs have a `mode`: **guided** accepts only the preset whitelists, while **expert** accepts ranges set by the `expert*` constants. `validateOptions` enforces both, `runLimits()` publishes them to the UI, and `frontend/src/utils/validation.ts` mirrors them for inline feedback only. `main()` refuses to start if either set of constants exceeds the agreed ceilings. It also gates runs on a passing `spt verify` (storage settings are in `storage.go`, state in `.dashboard-state/`). Credentials come only from the host `.env` and never from the browser. The server binds to loopback.

## Docs worth consulting
`cli/docs/SPT_SYNTAX.md` (all flags and the driver/workload matrix), `S3_INTEGRITY.md`, `S3_DELETE.md` (destructive-selection safety), `ENGINE_BUILD_INFO.md`, `REPLAY.md`, `PARTIAL_READS.md`, `S3_RDMA.md`, `S3_TABLES.md`, and `engine/README.md`.
