import { useCallback, useEffect, useMemo, useState } from "react";
import type { HistoryRun, Metrics, Options, Row, Sample, State } from "./types";
import { MetricCard } from "./components/MetricCard";
import { TrendChart } from "./components/TrendChart";
import {
  elapsed,
  formatNumber as fmt,
  numeric,
  phaseCode,
  phaseName,
  utc,
} from "./utils/metrics";

const defaults: Options = {
  object_count: 100,
  object_size: "64KiB",
  threads: 1,
  max_runtime_seconds: 60,
};
const sizeBytes: Record<string, number> = {
  "64KiB": 65536,
  "256KiB": 262144,
  "1MiB": 1048576,
};
const fields = [
  {
    key: "cards",
    title: "Performance cards",
    detail: "IOPS, bandwidth, latency, and failures",
  },
  {
    key: "charts",
    title: "Measured trends",
    detail: "Three graphs with a shared time window",
  },
  {
    key: "phases",
    title: "Phase results",
    detail: "Write, verify, and cleanup outcomes",
  },
  {
    key: "limits",
    title: "Performance limits",
    detail: "Thresholds saved for this run profile",
  },
  {
    key: "details",
    title: "SPT details",
    detail: "Timing, counters, concurrency, and source rows",
  },
  {
    key: "record",
    title: "Run record",
    detail: "Settings, timestamps, prefix, and exit code",
  },
];
const graphs = [
  {
    key: "throughput" as const,
    field: "interval_iops" as const,
    label: "IOPS",
    unit: "ops/s",
    color: "#347bd1",
  },
  {
    key: "bandwidth" as const,
    field: "bandwidth_mib_s" as const,
    label: "Bandwidth",
    unit: "MiB/s",
    color: "#188a82",
  },
  {
    key: "p50" as const,
    field: "p50_latency_us" as const,
    label: "Latency",
    unit: "µs",
    color: "#7a63ce",
  },
];
type Limits = {
  iops: number | null;
  bandwidth: number | null;
  latency: number | null;
};
const noLimits: Limits = { iops: null, bandwidth: null, latency: null };
function Status({ status }: { status: string }) {
  return (
    <span
      className={`status ${status === "completed" || status === "ready" ? "good" : "warn"}`}
    >
      <i />
      {status}
    </span>
  );
}

function useServer() {
  const [state, setState] = useState<State | null>(null),
    [error, setError] = useState(""),
    [received, setReceived] = useState("");
  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      if (location.protocol === "file:")
        throw new Error(
          "Open the dashboard through its local server to load SPT results.",
        );
      const r = await fetch("/api/state", { cache: "no-store", signal });
      if (!(r.headers.get("content-type") ?? "").includes("application/json"))
        throw new Error(
          "The dashboard server is unavailable. Open the app through the dashboard server or SSH tunnel.",
        );
      const s = await r.json();
      if (!r.ok)
        throw new Error(s.error ?? `Could not read SPT state (${r.status}).`);
      if (!s.target || !("job" in s) || !("metrics" in s))
        throw new Error(
          "The server returned an unsupported dashboard response.",
        );
      setState(s);
      setError("");
      setReceived(new Date().toISOString());
    } catch (e) {
      if (!signal?.aborted)
        setError(e instanceof Error ? e.message : "Could not read SPT state.");
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      await refresh(controller.signal);
      if (!controller.signal.aborted) timer = setTimeout(poll, 2000);
    };
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [refresh]);
  return { state, error, received, refresh };
}

export default function App() {
  const { state, error, received, refresh } = useServer();
  const [page, setPage] = useState<"dashboard" | "configure" | "history">("dashboard");
  const [mode, setMode] = useState<"guided" | "expert">("guided");
  const [selection, setSelection] = useState(fields.map((f) => f.key)),
    [choosing, setChoosing] = useState(false);
  const [historyRuns, setHistoryRuns] = useState<HistoryRun[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historyState, setHistoryState] = useState<State | null>(null);
  const [historyVersion, setHistoryVersion] = useState(0);

  useEffect(() => {
    if (page !== "history") return;
    const controller = new AbortController();
    setHistoryLoading(true);
    setHistoryError("");
    fetch("/api/runs", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Could not load run history.");
        setHistoryRuns(Array.isArray(body.runs) ? body.runs : []);
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setHistoryError(reason instanceof Error ? reason.message : "Could not load run history.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setHistoryLoading(false);
      });
    return () => controller.abort();
  }, [page, historyVersion]);

  const openSavedRun = async (runID: string) => {
    setHistoryError("");
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(runID)}`, { cache: "no-store" });
      const detail = await response.json();
      if (!response.ok) throw new Error(detail.error ?? "Could not open saved run.");
      setHistoryState(detail as State);
      setPage("dashboard");
    } catch (reason) {
      setHistoryError(reason instanceof Error ? reason.message : "Could not open saved run.");
    }
  };

  const showDashboard = () => {
    setHistoryState(null);
    setPage("dashboard");
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <a
          className="brand"
          href="#dashboard"
          onClick={showDashboard}
        >
          <span>SPT</span>
          <div>
            Storage Performance<small>BENCHMARK CONSOLE</small>
          </div>
        </a>
        <div className="sidebar-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          <button
            className={page === "dashboard" ? "selected" : ""}
            aria-current={page === "dashboard" ? "page" : undefined}
            onClick={showDashboard}
          >
            ◫ <span>Live dashboard</span>
          </button>
          <button
            className={page === "configure" ? "selected" : ""}
            aria-current={page === "configure" ? "page" : undefined}
            onClick={() => {
              setHistoryState(null);
              setPage("configure");
            }}
          >
            ＋ <span>Configure run</span>
          </button>
          <button
            className={page === "history" ? "selected" : ""}
            aria-current={page === "history" ? "page" : undefined}
            onClick={() => {
              setHistoryState(null);
              setPage("history");
            }}
          >
            ◷ <span>Run history</span>
          </button>
        </nav>
        <div className="sidebar-target">
          <span className="eyebrow">STORAGE TARGET</span>
          <strong>{state?.target.endpoint_label || "Awaiting server"}</strong>
          <p>{state?.target.bucket || "No bucket reported"}</p>
          {state && (
            <Status status={state.target.ready ? "ready" : "needs setup"} />
          )}
        </div>
        <div className="sidebar-footer">
          <span
            className={`source-dot ${state && !error ? "connected" : ""}`}
          />
          {error
            ? "Connection unavailable"
            : state
              ? "SPT server connected"
              : "Connecting to server"}
          <p>Single node · Write + verify</p>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span>Benchmark workspace</span>
          <div className="topbar-actions">
            <span className={`source-badge ${error ? "offline" : ""}`}>
              {error ? "OFFLINE" : state ? "SPT API" : "CONNECTING"}
            </span>
            <div className="mode-switch" role="group" aria-label="Display mode">
              {(["guided", "expert"] as const).map((m) => (
                <button
                  key={m}
                  className={mode === m ? "active" : ""}
                  aria-pressed={mode === m}
                  onClick={() => {
                    setMode(m);
                    setChoosing(m === "expert");
                    showDashboard();
                  }}
                >
                  {m === "guided" ? "Guided" : "Expert"}
                </button>
              ))}
            </div>
          </div>
        </header>
        <main>
          {error && (
            <div className="error" role="alert">
              <strong>Connection unavailable. </strong>
              {error}
              {received && (
                <p>
                  Showing the last received state from {utc(received)}. Run
                  controls are disabled until the connection returns.
                </p>
              )}
            </div>
          )}
          {page === "history" ? (
            <RunHistory
              runs={historyRuns}
              loading={historyLoading}
              error={historyError}
              onOpen={openSavedRun}
              onRefresh={() => setHistoryVersion((version) => version + 1)}
            />
          ) : page === "configure" ? (
            <Configure
              state={state}
              offline={!!error}
              onStarted={async () => {
                await refresh();
                showDashboard();
              }}
            />
          ) : mode === "expert" && choosing ? (
            <section className="panel expert-selection">
              <span className="eyebrow">EXPERT VIEW</span>
              <h1>Choose the data you need</h1>
              <p>
                Select the sections to include in your dashboard. Available
                values come from SPT.
              </p>
              <div className="selection-actions">
                <button onClick={() => setSelection(fields.map((f) => f.key))}>
                  Select all
                </button>
                <button onClick={() => setSelection([])}>
                  Clear selection
                </button>
              </div>
              <div className="expert-check-grid">
                {fields.map((f) => (
                  <label className="check-label" key={f.key}>
                    <input
                      type="checkbox"
                      checked={selection.includes(f.key)}
                      onChange={(e) =>
                        setSelection(
                          e.target.checked
                            ? [...selection, f.key]
                            : selection.filter((k) => k !== f.key),
                        )
                      }
                    />
                    <div>
                      <strong>{f.title}</strong>
                      <p>{f.detail}</p>
                    </div>
                  </label>
                ))}
              </div>
              <button
                className="primary"
                disabled={!selection.length}
                onClick={() => setChoosing(false)}
              >
                Open expert dashboard
              </button>
            </section>
          ) : (
            <>
              {mode === "expert" && (
                <div className="expert-edit">
                  <button onClick={() => setChoosing(true)}>
                    Change selected data
                  </button>
                </div>
              )}
              <Dashboard
                key={historyState?.job?.run_id ?? state?.metrics?.run_id ?? state?.job?.run_id ?? "empty"}
                state={historyState ?? state}
                historical={!!historyState}
                onBackHistory={() => setPage("history")}
                selected={
                  mode === "guided" ? fields.map((f) => f.key) : selection
                }
                onConfigure={() => setPage("configure")}
              />
            </>
          )}
        </main>
        <footer>
          Storage Performance Tool ·{" "}
          {received
            ? `State received ${utc(received)}`
            : "Waiting for server state"}{" "}
          · Refreshes every 2 seconds
        </footer>
      </div>
    </div>
  );
}

function Configure({
  state,
  offline,
  onStarted,
}: {
  state: State | null;
  offline: boolean;
  onStarted: () => Promise<void>;
}) {
  const [config, setConfig] = useState<Options>({ ...defaults }),
    [review, setReview] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const ready =
    !!state?.target.ready && !offline && state.job?.status !== "running";
  async function start() {
    if (busy || !ready) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const payload = await r.json();
      if (!r.ok)
        throw new Error(payload.error ?? `Run request failed (${r.status}).`);
      await onStarted();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start run.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel configure">
      <span className="eyebrow">NEW BENCHMARK</span>
      <h1>{review ? "Review your run" : "Configure a run"}</h1>
      <p>
        Write test objects, read them back to verify integrity, then clean up
        the run’s objects.
      </p>
      <div className="target-summary">
        <div>
          <span>Target</span>
          <strong>{state?.target.endpoint_label || "Not reported"}</strong>
        </div>
        <div>
          <span>Bucket</span>
          <strong>{state?.target.bucket || "Not reported"}</strong>
        </div>
        <Status status={state?.target.ready ? "ready" : "needs setup"} />
      </div>
      {state?.job?.status === "running" && (
        <div className="notice">
          A run is already in progress. Its results are available in Live
          dashboard.
        </div>
      )}
      {!!state?.target.reasons?.length && (
        <div className="notice">{state.target.reasons.join(" ")}</div>
      )}
      {review ? (
        <>
          <div className="review">
            <h2>Write + verify · single node</h2>
            <dl className="review-grid">
              <div>
                <dt>Maximum objects</dt>
                <dd>{config.object_count}</dd>
              </div>
              <div>
                <dt>Object size</dt>
                <dd>{config.object_size}</dd>
              </div>
              <div>
                <dt>Parallel threads</dt>
                <dd>{config.threads}</dd>
              </div>
              <div>
                <dt>Safety time limit</dt>
                <dd>{config.max_runtime_seconds}s</dd>
              </div>
            </dl>
            <p>
              Up to{" "}
              {fmt(
                (config.object_count * sizeBytes[config.object_size]) / 1048576,
                2,
              )}{" "}
              MiB of test data. A unique prefix isolates this run. Cleanup is
              best effort.
            </p>
          </div>
          <div className="actions">
            <button disabled={busy} onClick={() => setReview(false)}>
              Edit settings
            </button>
            <button
              className="primary"
              disabled={busy || !ready}
              onClick={() => void start()}
            >
              {busy ? "Starting…" : "Start run"}
            </button>
          </div>
          <p className="form-help">
            Starting runs a real benchmark on the configured storage target.
          </p>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setReview(true);
          }}
        >
          <div className="form-grid">
            <label>
              Maximum objects
              <select
                value={config.object_count}
                onChange={(e) =>
                  setConfig({ ...config, object_count: Number(e.target.value) })
                }
              >
                {[10, 25, 50, 100].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
              <small>Stop after this many objects.</small>
            </label>
            <label>
              Object size
              <select
                value={config.object_size}
                onChange={(e) =>
                  setConfig({ ...config, object_size: e.target.value })
                }
              >
                {Object.keys(sizeBytes).map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
              <small>Size of each test object.</small>
            </label>
            <label>
              Parallel threads
              <select
                value={config.threads}
                onChange={(e) =>
                  setConfig({ ...config, threads: Number(e.target.value) })
                }
              >
                {[1, 2].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
              <small>Concurrent requests from one node.</small>
            </label>
            <label>
              Safety time limit
              <select
                value={config.max_runtime_seconds}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    max_runtime_seconds: Number(e.target.value),
                  })
                }
              >
                {[60, 120].map((v) => (
                  <option key={v} value={v}>
                    {v} seconds
                  </option>
                ))}
              </select>
              <small>Maximum configured runtime.</small>
            </label>
          </div>
          <div className="notice">
            Maximum test data:{" "}
            <strong>
              {fmt(
                (config.object_count * sizeBytes[config.object_size]) / 1048576,
                2,
              )}{" "}
              MiB
            </strong>{" "}
            · Unique prefix · Best effort cleanup
          </div>
          <button className="primary" type="submit">
            Review run
          </button>
        </form>
      )}
      {error && (
        <div className="error run-error" role="alert">
          {error}
        </div>
      )}
    </section>
  );
}

function Dashboard({
  state,
  selected,
  onConfigure,
  historical = false,
  onBackHistory,
}: {
  state: State | null;
  selected: string[];
  onConfigure: () => void;
  historical?: boolean;
  onBackHistory?: () => void;
}) {
  const m = state?.metrics,
    job = state?.job;
  const summaries = m?.phase_summaries ?? [];
  const history =
    m?.chart_samples ?? (m?.is_aggregate ? [] : (m?.samples ?? []));
  const available: string[] = [
    ...new Set([
      ...summaries.map((r) => phaseCode(r.phase)),
      ...history.map((r) => phaseCode(r.op_type)),
      ...(m?.samples ?? []).map((r) => phaseCode(r.op_type)),
    ]),
  ];
  const [phase, setPhase] = useState<string>(
    phaseCode(m?.is_active ? m.phase : "CREATE"),
  );
  const selectedPhase = available.includes(phase)
    ? phase
    : (available[0] ?? "CREATE");
  const final = summaries.find((r) => phaseCode(r.phase) === selectedPhase);
  const latest = [...(m?.samples ?? []), ...history]
    .filter((r) => phaseCode(r.op_type) === selectedPhase)
    .sort(
      (a, b) => Date.parse(a.timestamp ?? "") - Date.parse(b.timestamp ?? ""),
    )
    .at(-1);
  const row: Row | undefined =
    !m?.is_active && final
      ? {
          ...final,
          interval_iops: final.iops,
          cumulative_ops: final.successful_ops,
          count_failed: final.failed_ops,
        }
      : latest;
  const progress =
    numeric(row?.completion_percent) ??
    (m?.is_active && phaseCode(m.phase) === selectedPhase
      ? numeric(m.progress_percent)
      : null);
  const failureCount = numeric(m?.total_failed) ?? numeric(row?.count_failed);
  const outcome =
    job?.status === "failed"
      ? "Run failed"
      : job?.status === "unknown"
        ? "Run outcome needs review"
        : failureCount !== null && failureCount > 0
          ? "Failed operations reported"
          : job?.status === "running"
            ? "Benchmark in progress"
            : job?.status === "completed"
              ? "Run completed"
              : m
                ? "Recorded SPT results"
                : "Ready for your first benchmark";
  const has = (key: string) => selected.includes(key);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">
            {job?.status === "running" ? "LIVE BENCHMARK" : "BENCHMARK RESULTS"}
          </span>
          <h1>
            {job?.status === "running"
              ? "Run in progress"
              : "Storage performance"}
          </h1>
          <p>
            {job?.run_id ||
              m?.run_id ||
              "Configure a run to measure your storage target."}
          </p>
        </div>
        <div className="actions">
          {historical && (
            <button onClick={onBackHistory}>Back to run history</button>
          )}
          {m && (
            <a
              className="button-link"
              href={`/api/runs/${encodeURIComponent(m.run_id)}/csv?kind=summary`}
              download
            >
              Export run CSV
            </a>
          )}
          <button className="primary" onClick={onConfigure}>
            ＋ Configure run
          </button>
        </div>
      </div>
      {!job && !m ? (
        <section className="panel empty-state">
          <div className="empty-icon">◫</div>
          <h2>
            {state
              ? "No benchmark results yet"
              : "Waiting for dashboard server"}
          </h2>
          <p>
            Configure a write and verify benchmark. Measured results will appear
            here as SPT runs.
          </p>
          <button className="primary" onClick={onConfigure}>
            Configure a run
          </button>
        </section>
      ) : (
        <>
          <section className="run-strip" aria-label="Run status">
            <div>
              <span>Status</span>
              <Status status={job?.status ?? "recorded"} />
            </div>
            <div>
              <span>Elapsed</span>
              <strong>{elapsed(job?.elapsed_seconds)}</strong>
            </div>
            <div>
              <span>Current phase</span>
              <strong>{job?.phase || phaseName(m?.phase)}</strong>
            </div>
            <div>
              <span>Workload</span>
              <strong>Write + verify</strong>
            </div>
            <div className="progress">
              <div>
                <span>Reported phase progress</span>
                <strong>
                  {progress === null ? "Not reported" : `${fmt(progress, 1)}%`}
                </strong>
              </div>
              {progress !== null && (
                <progress
                  max="100"
                  value={Math.max(0, Math.min(100, progress))}
                  aria-label="Reported phase progress"
                />
              )}
            </div>
          </section>
          <section className="panel outcome">
            <div>
              <span className="eyebrow">RUN OUTCOME</span>
              <h2>{outcome}</h2>
              <p>
                {job?.message ||
                  "SPT measurements from the configured storage target."}
              </p>
            </div>
            <div className="outcome-facts">
              <span>
                Failed operations<strong>{fmt(failureCount)}</strong>
                <small>
                  {numeric(m?.total_failed) !== null
                    ? "Across all recorded phases"
                    : `In ${phaseName(selectedPhase).toLowerCase()} phase`}
                </small>
              </span>
              <span>
                History captured<strong>{history.length} samples</strong>
                <small>Reported interval measurements</small>
              </span>
            </div>
          </section>
          {m && (
            <>
              <div className="scope-bar">
                <label>
                  Inspect phase
                  <select
                    value={selectedPhase}
                    onChange={(e) => setPhase(e.target.value)}
                  >
                    {available.map((p) => (
                      <option key={p} value={p}>
                        {phaseName(p)}
                      </option>
                    ))}
                  </select>
                </label>
                <p>
                  {!m.is_active && final
                    ? "Final phase averages"
                    : "Latest measured phase snapshot"}{" "}
                  · Missing values appear as —
                </p>
              </div>
              {has("cards") && (
                <div className="metrics-grid">
                  <MetricCard
                    label={`${phaseName(selectedPhase)} IOPS`}
                    value={fmt(row?.interval_iops, 2)}
                    unit="ops/s"
                    detail={
                      !m.is_active && final
                        ? "Average successful operations per second"
                        : "Latest reported rate of successful operations"
                    }
                  />
                  <MetricCard
                    label="Bandwidth"
                    value={fmt(row?.bandwidth_mib_s, 2)}
                    unit="MiB/s"
                    detail="Data transferred per second"
                    accent="teal"
                  />
                  <MetricCard
                    label="P50 latency"
                    value={fmt(row?.p50_latency_us, 1)}
                    unit="µs"
                    detail="Half of measured operations were faster"
                    accent="purple"
                  />
                  <MetricCard
                    label="Successful operations"
                    value={fmt(row?.cumulative_ops)}
                    detail={`In ${phaseName(selectedPhase).toLowerCase()} phase · ${fmt(row?.count_failed)} failed`}
                    accent="orange"
                  />
                </div>
              )}
              {has("limits") && (
                <PerformanceLimits
                  state={state!}
                  row={row}
                  phase={selectedPhase}
                />
              )}
              {has("charts") && (
                <Charts
                  key={selectedPhase}
                  metrics={m}
                  phase={selectedPhase}
                  startedAt={job?.started_at}
                />
              )}
              {has("phases") && (
                <PhaseResults metrics={m} onSelect={setPhase} />
              )}
              {has("details") && (
                <MeasuredDetails row={row} phase={selectedPhase} metrics={m} />
              )}
            </>
          )}
          {has("record") && (
            <details className="panel">
              <summary>Run record and settings</summary>
              <div className="detail-strip">
                <span>Started: {utc(job?.started_at)}</span>
                <span>Finished: {utc(job?.finished_at)}</span>
                <span>Exit code: {fmt(job?.returncode)}</span>
              </div>
              <dl className="record-grid">
                <div>
                  <dt>Objects</dt>
                  <dd>{fmt(job?.options?.object_count)}</dd>
                </div>
                <div>
                  <dt>Object size</dt>
                  <dd>{job?.options?.object_size ?? "—"}</dd>
                </div>
                <div>
                  <dt>Threads</dt>
                  <dd>{fmt(job?.options?.threads)}</dd>
                </div>
                <div>
                  <dt>Safety time limit</dt>
                  <dd>{elapsed(job?.options?.max_runtime_seconds)}</dd>
                </div>
                <div>
                  <dt>Run prefix</dt>
                  <dd>{job?.prefix ?? "—"}</dd>
                </div>
                <div>
                  <dt>Source</dt>
                  <dd>{m?.source_file ?? "—"}</dd>
                </div>
              </dl>
            </details>
          )}
        </>
      )}
    </>
  );
}

function RunHistory({
  runs,
  loading,
  error,
  onOpen,
  onRefresh,
}: {
  runs: HistoryRun[];
  loading: boolean;
  error: string;
  onOpen: (runID: string) => void;
  onRefresh: () => void;
}) {
  const localTime = (value?: string) => {
    const date = new Date(value ?? "");
    return Number.isNaN(date.getTime())
      ? "Time unavailable"
      : new Intl.DateTimeFormat(undefined, {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(date);
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">SAVED BENCHMARKS</span>
          <h1>Run history</h1>
          <p>SPT result folders saved on the project VM.</p>
        </div>
        <div className="actions">
          <button onClick={onRefresh} disabled={loading}>
            Refresh history
          </button>
        </div>
      </div>
      {error && <div className="error" role="alert">{error}</div>}
      <section className="panel run-history-panel">
        {loading && !runs.length ? (
          <p className="history-empty">Loading saved runs…</p>
        ) : runs.length ? (
          <div className="table-wrap">
            <table className="run-history-table">
              <thead>
                <tr>
                  <th>Started · local time</th>
                  <th>Run</th>
                  <th>Workload settings</th>
                  <th>Status</th>
                  <th>Phase results · successful / failed</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.run_id}>
                    <td>{localTime(run.started_at)}</td>
                    <td className="history-run-id">{run.run_id}</td>
                    <td>
                      {run.options?.object_count ?? "—"} × {run.options?.object_size ?? "—"}
                      <small>{run.options?.threads ?? "—"} thread(s)</small>
                    </td>
                    <td><Status status={run.status} /></td>
                    <td>
                      {run.phase_summaries.length ? (
                        run.phase_summaries.map((phase) => (
                          <span className="history-phase" key={phase.phase}>
                            {phaseName(phase.phase)} {fmt(phase.successful_ops)}/{fmt(phase.failed_ops)}
                          </span>
                        ))
                      ) : (
                        <span className="subtle">No phase totals saved</span>
                      )}
                    </td>
                    <td>
                      <button onClick={() => onOpen(run.run_id)}>View results</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="history-empty">
            <h2>No saved benchmark runs</h2>
            <p>Completed and partial SPT results will appear here.</p>
          </div>
        )}
        <p className="history-footnote">
          Times are shown in this computer’s local time. Older runs may have partial results if SPT stopped before writing its final summaries.
        </p>
      </section>
    </>
  );
}

function PerformanceLimits({
  state,
  row,
  phase,
}: {
  state: State;
  row?: Row;
  phase: string;
}) {
  const o = state.job?.options ?? defaults;
  const key = [
    "spt-performance-limits-v1",
    `${state.target.endpoint_label ?? ""}/${state.target.bucket ?? ""}`,
    o.object_size,
    o.threads,
  ].join(":");
  const [limits, setLimits] = useState<Limits>(noLimits),
    [draft, setDraft] = useState({ iops: "", bandwidth: "", latency: "" }),
    [message, setMessage] = useState("");
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? "null") ?? noLimits;
      const safe = {
        iops: numeric(saved.iops),
        bandwidth: numeric(saved.bandwidth),
        latency: numeric(saved.latency),
      };
      setLimits(safe);
      setDraft({
        iops: safe.iops === null ? "" : String(safe.iops),
        bandwidth: safe.bandwidth === null ? "" : String(safe.bandwidth),
        latency: safe.latency === null ? "" : String(safe.latency),
      });
    } catch {
      setLimits(noLimits);
      setDraft({ iops: "", bandwidth: "", latency: "" });
    }
    setMessage("");
  }, [key]);
  const checks = [
    {
      key: "iops" as const,
      value: numeric(row?.interval_iops),
      label: "IOPS",
      minimum: true,
    },
    {
      key: "bandwidth" as const,
      value: numeric(row?.bandwidth_mib_s),
      label: "Bandwidth",
      minimum: true,
    },
    {
      key: "latency" as const,
      value: numeric(row?.p50_latency_us),
      label: "P50 latency",
      minimum: false,
    },
  ];
  function save() {
    const parsed = Object.fromEntries(
      Object.entries(draft).map(([k, v]) => [
        k,
        v.trim() === "" ? null : Number(v),
      ]),
    ) as Limits;
    if (
      Object.values(parsed).some(
        (v) => v !== null && (!Number.isFinite(v) || v < 0),
      )
    ) {
      setMessage("Enter zero or a positive number.");
      return;
    }
    try {
      localStorage.setItem(key, JSON.stringify(parsed));
      setLimits(parsed);
      setMessage("Limits saved in this browser.");
    } catch {
      setMessage("Browser storage unavailable; limits could not be saved.");
    }
  }
  return (
    <details className="panel limits">
      <summary>
        Performance limits{" "}
        <span className="summary-note">
          {phaseName(phase)} ·{" "}
          {checks.filter((c) => limits[c.key] !== null).length}/3 set
        </span>
      </summary>
      <p className="form-help">
        Set your team’s expectations for {state.target.endpoint_label},{" "}
        {o.object_size} objects, and {o.threads} thread
        {o.threads === 1 ? "" : "s"}. These limits stay in this browser and
        apply to the selected phase.
      </p>
      <div className="form-grid limits-grid">
        {checks.map((c) => {
          const limit = limits[c.key],
            value = c.value;
          const result =
            limit === null
              ? "No limit set"
              : value === null
                ? "Not measured"
                : (c.minimum ? value >= limit : value <= limit)
                  ? "Within limit"
                  : "Outside limit";
          return (
            <label key={c.key}>
              {c.minimum ? "Minimum" : "Maximum"} {c.label} (
              {c.key === "iops"
                ? "ops/s"
                : c.key === "bandwidth"
                  ? "MiB/s"
                  : "µs"}
              )
              <input
                type="number"
                min="0"
                step="any"
                placeholder="No limit set"
                value={draft[c.key]}
                onChange={(e) =>
                  setDraft({ ...draft, [c.key]: e.target.value })
                }
              />
              <span
                className={result === "Outside limit" ? "limit-bad" : "subtle"}
              >
                {result} · measured {fmt(value, 2)}
              </span>
            </label>
          );
        })}
      </div>
      <div className="actions">
        <button className="primary" onClick={save}>
          Save limits
        </button>
        <button
          onClick={() => {
            try {
              localStorage.removeItem(key);
              setLimits(noLimits);
              setDraft({ iops: "", bandwidth: "", latency: "" });
              setMessage("Limits cleared.");
            } catch {
              setMessage("Browser storage unavailable.");
            }
          }}
        >
          Clear limits
        </button>
        <span className="subtle" role="status">
          {message}
        </span>
      </div>
    </details>
  );
}

function Charts({
  metrics: m,
  phase,
  startedAt,
}: {
  metrics: Metrics;
  phase: string;
  startedAt?: string;
}) {
  const history = m.chart_samples ?? (m.is_aggregate ? [] : (m.samples ?? []));
  const samples = useMemo(() => {
    const rows = history
      .filter(
        (r) =>
          phaseCode(r.op_type) === phase &&
          Number.isFinite(Date.parse(r.timestamp ?? "")),
      )
      .sort((a, b) => Date.parse(a.timestamp!) - Date.parse(b.timestamp!));
    const start = Date.parse(startedAt ?? ""),
      origin = Number.isFinite(start)
        ? start
        : Date.parse(rows[0]?.timestamp ?? "");
    return rows.map((r): Sample => ({
      row: r,
      timestamp: r.timestamp!,
      elapsed: Math.max(0, (Date.parse(r.timestamp!) - origin) / 1000),
      throughput: numeric(r.interval_iops),
      bandwidth: numeric(r.bandwidth_mib_s),
      p50: numeric(r.p50_latency_us),
      p99: numeric(r.latency_p99_us),
    }));
  }, [history, phase, startedAt]);
  const [mode, setMode] = useState<"timeline" | "summary">("timeline"),
    [cleanup, setCleanup] = useState(false),
    [active, setActive] = useState<number | null>(null);
  const first = samples[0]?.elapsed ?? 0,
    last = samples.at(-1)?.elapsed ?? first;
  const [windowSize, setWindowSize] = useState<number | null>(null),
    [position, setPosition] = useState<number | null>(null);
  const width = windowSize ?? Math.max(1, last - first),
    end = position === null ? last : Math.min(last, Math.max(first, position)),
    start = Math.max(first, end - width);
  const shown = samples.filter((s) => s.elapsed >= start && s.elapsed <= end);
  const display =
    !samples.length && (m.phase_summaries?.length ?? 0) > 0 ? "summary" : mode;
  const inspected = shown[active ?? shown.length - 1];
  useEffect(() => {
    setActive(null);
  }, [phase, start, end, shown.length]);
  const summaries = (m.phase_summaries ?? []).filter(
    (r) => cleanup || phaseCode(r.phase) !== "DELETE",
  );
  return (
    <section className="panel fleet">
      <div className="section-heading">
        <div>
          <h2>Measured performance</h2>
          <p>
            {display === "timeline"
              ? `${phaseName(phase)} phase · ${samples.length} recorded samples`
              : "Final averages by phase"}
          </p>
        </div>
        <select
          aria-label="Chart view"
          value={display}
          onChange={(e) => {
            setMode(e.target.value as "timeline" | "summary");
            setActive(null);
          }}
        >
          <option value="timeline" disabled={!samples.length}>
            Over time
          </option>
          <option value="summary" disabled={!m.phase_summaries?.length}>
            Phase comparison
          </option>
        </select>
      </div>
      {display === "timeline" ? (
        <>
          <div className="fleet-toolbar">
            <label className="check-label">
              Time window
              <select
                aria-label="Time window"
                value={windowSize ?? "all"}
                onChange={(e) => {
                  setWindowSize(
                    e.target.value === "all" ? null : Number(e.target.value),
                  );
                  setPosition(null);
                }}
              >
                {[
                  ["all", "Entire phase"],
                  ["60", "1 minute"],
                  ["300", "5 minutes"],
                  ["3600", "1 hour"],
                  ["86400", "1 day"],
                ].map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
                {windowSize !== null &&
                  ![60, 300, 3600, 86400].includes(windowSize) && (
                    <option value={windowSize}>
                      Custom · {elapsed(windowSize)}
                    </option>
                  )}
              </select>
            </label>
            <div className="button-group">
              <button
                disabled={samples.length < 2}
                onClick={() => setWindowSize(Math.max(1, width / 2))}
              >
                Zoom in
              </button>
              <button
                disabled={windowSize === null}
                onClick={() =>
                  setWindowSize(width * 2 >= last - first ? null : width * 2)
                }
              >
                Zoom out
              </button>
              <button
                onClick={() => {
                  setWindowSize(null);
                  setPosition(null);
                }}
              >
                Fit phase
              </button>
              <button
                disabled={position === null}
                onClick={() => setPosition(null)}
              >
                Follow latest
              </button>
            </div>
            {shown.length ? (
              <a
                className="button-link"
                href={`/api/runs/${encodeURIComponent(m.run_id)}/csv?kind=window&phase=${phase}&start=${start}&end=${end}`}
                download
              >
                Export window CSV
              </a>
            ) : (
              <button disabled>Export window CSV</button>
            )}
          </div>
          {samples.length > 1 && (
            <label className="timeline-pan">
              Move time window
              <input
                aria-label="Move time window"
                type="range"
                min={Math.min(last, first + width)}
                max={last}
                step="any"
                disabled={windowSize === null || width >= last - first}
                value={end}
                onChange={(e) => setPosition(Number(e.target.value))}
              />
              <span>
                {elapsed(start)} – {elapsed(end)} from run start
              </span>
            </label>
          )}
          {!samples.length && (
            <div className="notice">
              No interval history recorded for this phase. Final phase averages
              appear once SPT reports them.
            </div>
          )}
          {samples.length === 1 && (
            <div className="notice">
              One measured point is available. It cannot establish a trend.
            </div>
          )}
          {graphs.map((g) => (
            <TrendChart
              key={g.key}
              samples={shown}
              title={g.label}
              unit={g.unit}
              series={
                g.key === "p50"
                  ? [
                      { key: "p50", label: "P50", color: g.color },
                      { key: "p99", label: "P99", color: "#b096e7" },
                    ]
                  : [{ key: g.key, label: g.label, color: g.color }]
              }
              active={active !== null && active < shown.length ? active : null}
              onInspect={setActive}
            />
          ))}
          <p className="chart-readout" aria-live="polite">
            {inspected
              ? `${elapsed(inspected.elapsed)} · ${utc(inspected.timestamp)} · IOPS ${fmt(inspected.throughput, 2)} ops/s · bandwidth ${fmt(inspected.bandwidth, 2)} MiB/s · P50 ${fmt(inspected.p50, 1)} µs`
              : "Waiting for measured samples in this time window."}
          </p>
          <p className="subtle">
            All three graphs share the time window and inspector. Each uses its
            own scale. Missing measurements are shown as gaps.
          </p>
        </>
      ) : (
        <>
          <label className="check-label">
            <input
              type="checkbox"
              checked={cleanup}
              onChange={(e) => setCleanup(e.target.checked)}
            />
            Include cleanup in comparison
          </label>
          <div className="comparison-grid">
            {graphs.map((g) => {
              const field = g.key === "throughput" ? "iops" : g.field;
              const max = Math.max(
                1,
                ...summaries.map((r) => numeric(r[field]) ?? 0),
              );
              return (
                <article className="comparison" key={g.key}>
                  <h3>
                    {g.label} <span>{g.unit}</span>
                  </h3>
                  {summaries.map((r) => {
                    const v = numeric(r[field]);
                    return (
                      <div className="comparison-row" key={r.phase}>
                        <span>{phaseName(r.phase)}</span>
                        <div>
                          {v !== null && (
                            <i
                              style={{
                                width: `${(v / max) * 100}%`,
                                background: g.color,
                              }}
                            />
                          )}
                        </div>
                        <strong>{fmt(v, 2)}</strong>
                      </div>
                    );
                  })}
                </article>
              );
            })}
          </div>
          <p className="subtle">
            These bars are final phase averages. They do not represent interval
            history. Cleanup normally transfers no object payload.
          </p>
        </>
      )}
    </section>
  );
}

function PhaseResults({
  metrics: m,
  onSelect,
}: {
  metrics: Metrics;
  onSelect: (phase: string) => void;
}) {
  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <h2>Phase results</h2>
          <p>Each phase has its own counters and timing.</p>
        </div>
      </div>
      {m.phase_summaries?.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {[
                  "Phase",
                  "Successful",
                  "Failed",
                  "Corrupt",
                  "Duration",
                  "IOPS",
                  "MiB/s",
                  "P50 (µs)",
                ].map((h) => (
                  <th key={h} scope="col">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {m.phase_summaries.map((r) => (
                <tr key={r.phase}>
                  <td>
                    <button
                      className="table-link"
                      onClick={() => onSelect(phaseCode(r.phase))}
                    >
                      {phaseName(r.phase)}
                    </button>
                  </td>
                  <td>{fmt(r.successful_ops)}</td>
                  <td>{fmt(r.failed_ops)}</td>
                  <td>{fmt(r.corrupt_ops)}</td>
                  <td>{elapsed(r.duration_seconds)}</td>
                  <td>{fmt(r.iops, 2)}</td>
                  <td>{fmt(r.bandwidth_mib_s, 2)}</td>
                  <td>{fmt(r.p50_latency_us, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="form-help">
          Final phase results will appear as SPT writes its output.
        </p>
      )}
    </section>
  );
}

function MeasuredDetails({
  row,
  phase,
  metrics: m,
}: {
  row?: Row;
  phase: string;
  metrics: Metrics;
}) {
  const groups: { title: string; values: [string, string][] }[] = [
    {
      title: "Counts and data",
      values: [
        ["Successful operations", fmt(row?.cumulative_ops)],
        ["Failed operations", fmt(row?.count_failed)],
        ["Corrupt operations", fmt(row?.corrupt_ops)],
        ["Bytes processed", fmt(row?.bytes_processed)],
        ["Phase duration", elapsed(row?.duration_seconds)],
        ["Average IOPS", fmt(row?.average_iops ?? row?.iops, 2)],
      ],
    },
    {
      title: "Latency · µs",
      values: [
        ["P50", fmt(row?.p50_latency_us, 1)],
        ["P99", fmt(row?.latency_p99_us, 1)],
        ["Mean", fmt(row?.latency_mean_us, 1)],
        ["Minimum", fmt(row?.latency_min_us, 1)],
        ["Maximum", fmt(row?.latency_max_us, 1)],
      ],
    },
    {
      title: "Execution",
      values: [
        ["Concurrency", fmt(row?.concurrency)],
        ["Mean concurrency", fmt(row?.concurrency_mean, 2)],
        ["Nodes", fmt(row?.node_count)],
        ["Step", row?.step_id ?? "—"],
        ["Measurement time", utc(row?.timestamp)],
      ],
    },
  ];
  return (
    <details className="panel">
      <summary>
        SPT measured details{" "}
        <span className="summary-note">{phaseName(phase)} phase</span>
      </summary>
      <p className="form-help">
        All fields available from the dashboard API are retained below. A dash
        means SPT did not report a value.
      </p>
      <div className="guided-core-grid">
        {groups.map((g) => (
          <section className="timing" key={g.title}>
            <h3>{g.title}</h3>
            <dl>
              {g.values.map(([name, value]) => (
                <div key={name}>
                  <dt>{name}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <details className="raw-details">
        <summary>Source measurements and metadata</summary>
        <div className="actions">
          <a
            className="button-link"
            href={`/api/runs/${encodeURIComponent(m.run_id)}/csv?kind=samples`}
            download
          >
            Export all samples CSV
          </a>
        </div>
        <pre>{JSON.stringify(m, null, 2)}</pre>
      </details>
    </details>
  );
}
