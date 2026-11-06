import {
  Accordion,
  Alert,
  Badge,
  Box,
  Button,
  Checkbox,
  Drawer,
  NativeSelect,
  NavLink,
  Paper,
  Progress,
  SegmentedControl,
  Text,
  Title,
  UnstyledButton,
} from "@mantine/core";
import {
  ArrowLeftRight,
  ExternalLink,
  History,
  LayoutDashboard,
  ListFilter,
  Plus,
  Square,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { Row, RunMode, State } from "./types";
import { useStopRun } from "./api/mutations";
import { useSavedRun, useServerState } from "./api/queries";
import { MetricCard } from "./components/MetricCard";
import { Configure } from "./components/Configure";
import { Status } from "./components/Status";
import { PerformanceLimits } from "./components/PerformanceLimits";
import { MeasuredDetails, PhaseResults } from "./components/RunMetrics";
import { Charts } from "./components/RunCharts";
import { RunHistory } from "./components/RunHistory";
import { ConnectRun } from "./components/ConnectRun";
import { Catalog } from "./components/Catalog";
import { Compare } from "./components/Compare";
import { NodeTable } from "./components/NodeTable";
import { RunWarnings } from "./components/RunWarnings";
import { RunLog } from "./components/RunLog";
import { runWorkloadType, workloadLabel } from "./utils/catalog";
import {
  elapsed,
  formatMetric,
  formatNumber as fmt,
  numeric,
  phaseCode,
  phaseName,
  utc,
} from "./utils/metrics";

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
const expertViewSelectionKey = "spt-expert-visible-sections-v1";
const allSectionKeys = () => fields.map((field) => field.key);
function loadVisibleSections(): string[] {
  try {
    const stored: unknown = JSON.parse(
      localStorage.getItem(expertViewSelectionKey) ?? "null",
    );
    if (!Array.isArray(stored)) return allSectionKeys();
    return allSectionKeys().filter((key) => stored.includes(key));
  } catch {
    return allSectionKeys();
  }
}

export default function App() {
  const server = useServerState();
  const state = server.data ?? null;
  const error = server.error?.message ?? "";
  const received = server.dataUpdatedAt
    ? new Date(server.dataUpdatedAt).toISOString()
    : "";
  const [page, setPage] = useState<
    "dashboard" | "configure" | "history" | "connect" | "catalog" | "compare"
  >("configure");
  const [compareIDs, setCompareIDs] = useState<string[]>([]),
    [compareBaseline, setCompareBaseline] = useState("");
  const [landed, setLanded] = useState(false);
  // Open on the live view only when a run is already in progress at first load.
  if (state && !landed) {
    setLanded(true);
    if (state.job?.status === "running") setPage("dashboard");
  }
  const clients = state?.storage?.hosts.length ?? 1;
  const [mode, setMode] = useState<RunMode>("guided");
  const [selection, setSelection] = useState<string[]>(loadVisibleSections);
  const [customizing, setCustomizing] = useState(false);
  // View preferences are browser-only. They do not affect the SPT run or API.
  useEffect(() => {
    try {
      localStorage.setItem(expertViewSelectionKey, JSON.stringify(selection));
    } catch {
      // The dashboard still works if browser storage is unavailable.
    }
  }, [selection]);
  const [historyRunID, setHistoryRunID] = useState<string | null>(null);
  const savedRun = useSavedRun(
    page === "history" || page === "dashboard" ? historyRunID : null,
  );
  const historyState = historyRunID ? (savedRun.data ?? null) : null;
  // Keep the history list visible until the selected run has finished loading.
  if (
    page === "history" &&
    historyRunID &&
    savedRun.isSuccess &&
    !savedRun.isFetching
  ) {
    setCustomizing(false);
    setPage("dashboard");
  }

  const openSavedRun = (runID: string) => {
    if (historyRunID === runID) void savedRun.refetch();
    else setHistoryRunID(runID);
  };

  const showDashboard = () => {
    setHistoryRunID(null);
    setCustomizing(false);
    setPage("dashboard");
  };

  const showHistory = () => {
    setHistoryRunID(null);
    setPage("history");
  };

  return (
    <div className="flex min-h-screen max-[47.5rem]:block">
      <Box
        component="aside"
        bg="var(--spt-surface-panel)"
        className="sticky top-0 flex h-screen w-58.75 shrink-0 flex-col border-r-[0.0625rem] border-divider px-lg py-xl max-[71.875rem]:w-48.75 max-[71.875rem]:px-3.5 max-[71.875rem]:py-6.25 max-[47.5rem]:static max-[47.5rem]:h-auto max-[47.5rem]:w-full max-[47.5rem]:border-r-0 max-[47.5rem]:border-b-[0.0625rem] max-[47.5rem]:px-comfortable max-[47.5rem]:py-3.75"
      >
        <UnstyledButton
          component="a"
          href="#dashboard"
          className="flex items-center gap-sm"
          onClick={showDashboard}
        >
          <Text
            component="span"
            bg="var(--mantine-primary-color-filled)"
            c="var(--spt-text-inverse)"
            bdrs="lg"
            size="emphasis"
            fw="var(--mantine-font-weight-heading)"
            lh="normal"
            className="grid size-10.5 shrink-0 place-items-center"
          >
            SPT
          </Text>
          <div className="min-w-0">
            <Text
              size="sm"
              c="var(--spt-text-primary)"
              fw="var(--mantine-font-weight-heading)"
              lh="normal"
            >
              {state?.branding?.product_name ?? "Storage Performance Tool"}
            </Text>
            <Text
              component="small"
              size="xxs"
              c="var(--spt-text-subtle)"
              lh="normal"
              className="mt-1.5 block tracking-[0.0625rem] max-[47.5rem]:hidden"
            >
              {(
                state?.branding?.environment_label ?? "BENCHMARK CONSOLE"
              ).toUpperCase()}
            </Text>
          </div>
        </UnstyledButton>
        <Text
          size="xs"
          c="var(--spt-text-subtle)"
          lh="normal"
          className="mx-sm mt-xxxl mb-3.5 tracking-[0.09375rem] max-[47.5rem]:hidden"
        >
          WORKSPACE
        </Text>
        <nav
          aria-label="Main navigation"
          className="grid gap-xs max-[47.5rem]:mt-3.75 max-[47.5rem]:flex max-[47.5rem]:flex-wrap"
        >
          <NavLink
            component="button"
            type="button"
            label="Configure run"
            leftSection={<Plus size="1rem" aria-hidden="true" />}
            active={page === "configure"}
            aria-current={page === "configure" ? "page" : undefined}
            onClick={() => {
              setHistoryRunID(null);
              setPage("configure");
            }}
          />
          <NavLink
            component="button"
            type="button"
            label="Live dashboard"
            leftSection={<LayoutDashboard size="1rem" aria-hidden="true" />}
            active={page === "dashboard"}
            aria-current={page === "dashboard" ? "page" : undefined}
            onClick={showDashboard}
          />
          <NavLink
            component="button"
            type="button"
            label="Run history"
            leftSection={<History size="1rem" aria-hidden="true" />}
            active={page === "history"}
            aria-current={page === "history" ? "page" : undefined}
            onClick={() => {
              setHistoryRunID(null);
              showHistory();
            }}
          />
          <NavLink
            component="button"
            type="button"
            label="Results catalog"
            leftSection={<ListFilter size="1rem" aria-hidden="true" />}
            active={page === "catalog"}
            aria-current={page === "catalog" ? "page" : undefined}
            onClick={() => setPage("catalog")}
          />
          <NavLink
            component="button"
            type="button"
            label="Compare runs"
            leftSection={<ArrowLeftRight size="1rem" aria-hidden="true" />}
            active={page === "compare"}
            aria-current={page === "compare" ? "page" : undefined}
            onClick={() => setPage("compare")}
          />
          <NavLink
            component="button"
            type="button"
            label="Connect to active run"
            leftSection={<ExternalLink size="1rem" aria-hidden="true" />}
            active={page === "connect"}
            aria-current={page === "connect" ? "page" : undefined}
            onClick={() => setPage("connect")}
          />
        </nav>
        <div className="mx-sm mt-xxl mb-section border-t-[0.0625rem] border-divider pt-section wrap-anywhere max-[47.5rem]:hidden">
          <Text
            size="xxs"
            c="var(--spt-text-muted)"
            fw="var(--mantine-font-weight-heading)"
            lh="normal"
            className="mb-compact tracking-[0.08125rem]"
          >
            STORAGE TARGET
          </Text>
          <Text
            component="strong"
            size="sm"
            c="var(--spt-text-primary)"
            fw="var(--mantine-font-weight-bold)"
            lh="normal"
          >
            {state?.target.endpoint_label || "Awaiting server"}
          </Text>
          <Text size="caption" className="mt-xs mb-sm">
            {state?.target.bucket || "No bucket reported"}
          </Text>
          {state && (
            <Status status={state.target.ready ? "ready" : "needs setup"} />
          )}
        </div>
        <Text
          component="div"
          size="caption"
          c="var(--spt-text-muted)"
          lh="normal"
          className="mt-auto max-[47.5rem]:hidden"
        >
          <Box
            component="span"
            aria-hidden="true"
            bg={state && !error ? "var(--spt-chart-bandwidth)" : "#e2a243"}
            bdrs="50%"
            className="mr-xs inline-block size-1.75"
          />
          {error
            ? "Connection unavailable"
            : state
              ? "SPT server connected"
              : "Connecting to server"}
          <Text size="xs" className="my-xs">
            {clients} client machine{clients === 1 ? "" : "s"} ·{" "}
            {workloadLabel(runWorkloadType(state?.metrics, state?.job))}
          </Text>
        </Text>
      </Box>
      <div className="min-w-0 flex-1">
        <Box
          component="header"
          bg="#ffffffc9"
          className="flex h-19 items-center justify-between border-b-[0.0625rem] border-divider px-xxl max-[71.875rem]:px-section max-[47.5rem]:h-auto max-[47.5rem]:min-h-19 max-[47.5rem]:flex-wrap max-[47.5rem]:gap-xs max-[47.5rem]:p-md"
        >
          <Text
            component="span"
            size="sm"
            c="var(--spt-text-muted)"
            lh="normal"
          >
            Benchmark workspace
          </Text>
          <div className="flex items-center gap-lg max-[47.5rem]:gap-compact">
            <Badge
              color={error ? "yellow" : "spt"}
              c={
                error
                  ? "var(--spt-status-warning-text)"
                  : "var(--mantine-color-spt-7)"
              }
              fz="xxs"
              tt="uppercase"
              lh="normal"
              px="xs"
              styles={{
                root: {
                  paddingBlock: "0.3125rem",
                  borderColor: error
                    ? "var(--spt-status-warning-border)"
                    : "var(--mantine-color-spt-2)",
                  letterSpacing: "0.05rem",
                },
              }}
            >
              {error
                ? "OFFLINE"
                : state?.connection?.mode === "attached"
                  ? "ATTACHED · READ ONLY"
                  : state
                    ? "SPT API"
                    : "CONNECTING"}
            </Badge>
            <SegmentedControl<RunMode>
              aria-label="Display mode"
              name="display-mode"
              value={mode}
              data={[
                { value: "guided", label: "Guided" },
                { value: "expert", label: "Expert" },
              ]}
              onChange={(nextMode) => {
                setMode(nextMode);
                setCustomizing(false);
                // On Configure, the mode switches the workload form in place.
                if (page !== "configure") showDashboard();
              }}
            />
          </div>
        </Box>
        <main className="mx-auto max-w-387.5 px-xxl py-8 min-[93.75rem]:pt-10 max-[71.875rem]:p-section max-[47.5rem]:px-md max-[47.5rem]:py-panel">
          {error && (
            <Alert color="red" role="alert">
              <strong>Connection unavailable. </strong>
              {error}
              {received && (
                <Text>
                  Showing the last received state from {utc(received)}. Run
                  controls are disabled until the connection returns.
                </Text>
              )}
            </Alert>
          )}
          {page === "connect" ? (
            <ConnectRun
              state={state}
              offline={!!error}
              onConnected={showDashboard}
            />
          ) : page === "catalog" ? (
            <Catalog
              onCompare={(ids, baseline) => {
                setCompareIDs(ids);
                setCompareBaseline(baseline);
                setPage("compare");
              }}
            />
          ) : page === "compare" ? (
            <Compare
              key={compareIDs.join(",") + compareBaseline}
              ids={compareIDs}
              baseline={compareBaseline}
              onBack={() => setPage("catalog")}
            />
          ) : page === "history" ? (
            <RunHistory
              opening={!!historyRunID && savedRun.isFetching}
              error={savedRun.error?.message ?? ""}
              onOpen={openSavedRun}
              onRefresh={() => setHistoryRunID(null)}
            />
          ) : page === "configure" ? (
            <Configure
              state={state}
              mode={mode}
              offline={!!error}
              onStarted={showDashboard}
            />
          ) : (
            <>
              {mode === "expert" && (
                <div className="flex justify-end mb-comfortable">
                  <Button type="button" onClick={() => setCustomizing(true)}>
                    Customize view
                  </Button>
                </div>
              )}
              <Dashboard
                key={
                  historyState?.job?.run_id ??
                  state?.metrics?.run_id ??
                  state?.job?.run_id ??
                  "empty"
                }
                state={historyState ?? state}
                historical={!!historyState}
                onBackHistory={showHistory}
                selected={
                  mode === "guided" ? fields.map((f) => f.key) : selection
                }
                onConfigure={() => setPage("configure")}
              />
              {mode === "expert" && (
                <Drawer
                  opened={customizing}
                  onClose={() => setCustomizing(false)}
                  title={
                    <>
                      <Text
                        component="span"
                        className="block"
                        size="xs"
                        fw="var(--mantine-font-weight-bold)"
                        tt="uppercase"
                      >
                        Expert view
                      </Text>
                      <Text
                        component="span"
                        className="block"
                        size="xl"
                        c="var(--spt-text-primary)"
                        fw="var(--mantine-font-weight-heading)"
                      >
                        Customize dashboard
                      </Text>
                    </>
                  }
                  closeButtonProps={{ "aria-label": "Close customization" }}
                >
                  <Text size="sm">
                    Show or hide sections. This only changes your display, not
                    the benchmark or its data.
                  </Text>
                  <div className="flex gap-xs">
                    <Button onClick={() => setSelection(allSectionKeys())}>
                      Show all
                    </Button>
                    <Button onClick={() => setSelection([])}>Hide all</Button>
                  </div>
                  <div className="grid gap-2.25">
                    {fields.map((field) => (
                      <Paper
                        key={field.key}
                        p="sm"
                        radius="md"
                        bg="var(--spt-surface-subtle)"
                      >
                        <Checkbox
                          label={field.title}
                          description={field.detail}
                          checked={selection.includes(field.key)}
                          onChange={(event) =>
                            setSelection((previous) =>
                              event.target.checked
                                ? [...previous, field.key]
                                : previous.filter((key) => key !== field.key),
                            )
                          }
                        />
                      </Paper>
                    ))}
                  </div>
                  <div className="mt-auto flex items-center justify-between gap-compact border-t-[0.0625rem] border-divider pt-comfortable">
                    <Text size="sm">
                      {selection.length} of {fields.length} sections shown
                    </Text>
                    <Button
                      variant="filled"
                      onClick={() => setCustomizing(false)}
                    >
                      Done
                    </Button>
                  </div>
                </Drawer>
              )}
            </>
          )}
        </main>
        <Text
          component="footer"
          size="xs"
          c="var(--spt-text-subtle)"
          lh="normal"
          className="px-xxl pb-6.25 max-[47.5rem]:px-md max-[47.5rem]:pb-lg"
        >
          {state?.branding?.product_name ?? "Storage Performance Tool"} ·{" "}
          {received
            ? `State received ${utc(received)}`
            : "Waiting for server state"}{" "}
          · Refreshes every 2 seconds
        </Text>
      </div>
    </div>
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
  const stopping = useStopRun();
  const stopError = stopping.error?.message;
  // An attached CLI run is monitored read-only, so it cannot be stopped here.
  const canStop =
    !historical &&
    job?.status === "running" &&
    state?.connection?.mode !== "attached";
  const stopPending = stopping.isPending || !!job?.stop_requested;
  function stop() {
    if (!canStop || stopPending) return;
    if (
      window.confirm(
        "Stop this run? It ends now and won't finish its remaining phases.",
      )
    ) {
      stopping.mutate();
    }
  }
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
      : job?.status === "stopped"
        ? "Run stopped"
        : job?.status === "running" && job.stop_requested
          ? "Stopping run…"
          : job?.status === "interrupted"
            ? "Run interrupted"
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
      <div className="flex justify-between items-center mb-6.5 gap-md max-[47.5rem]:items-start max-[47.5rem]:flex-col">
        <div className="min-w-0">
          <span className="block text-xs/[inherit] tracking-[0.08125rem] text-[#6b7f99] font-heading mb-compact">
            {job?.status === "running" ? "LIVE BENCHMARK" : "BENCHMARK RESULTS"}
          </span>
          <Title order={1}>
            {job?.status === "running"
              ? "Run in progress"
              : "Storage performance"}
          </Title>
          <Text size="sm" className="mt-xs wrap-anywhere">
            {job?.run_id ||
              m?.run_id ||
              "Configure a run to measure your storage target."}
          </Text>
        </div>
        <div className="flex flex-wrap items-center gap-compact max-[47.5rem]:w-full">
          {historical && (
            <Button onClick={onBackHistory}>Back to run history</Button>
          )}
          {job?.status === "completed" && summaries.length > 0 && m && (
            <Button
              component="a"
              href={`/api/runs/${encodeURIComponent(m.run_id)}/csv?kind=summary`}
              download
            >
              Download CSV report
            </Button>
          )}
          {canStop && (
            <Button
              color="red"
              variant="light"
              onClick={stop}
              disabled={stopPending}
              loading={stopPending}
              leftSection={<Square size="0.875rem" aria-hidden="true" />}
            >
              {stopPending ? "Stopping…" : "Stop run"}
            </Button>
          )}
          <Button
            variant="filled"
            onClick={onConfigure}
            leftSection={<Plus size="1rem" aria-hidden="true" />}
          >
            Configure run
          </Button>
        </div>
      </div>
      {stopError && (
        <Alert color="red" role="alert">
          {stopError}
        </Alert>
      )}
      {!job && !m ? (
        <Paper
          component="section"
          className="mb-panel px-section py-16 text-center"
        >
          <Paper
            radius="xl"
            bg="var(--spt-surface-selected)"
            className="mx-auto mb-lg grid size-14 place-items-center"
          >
            <LayoutDashboard
              size="1.625rem"
              color="var(--spt-action-primary)"
              aria-hidden="true"
            />
          </Paper>
          <Title order={2}>
            {state
              ? "No benchmark results yet"
              : "Waiting for dashboard server"}
          </Title>
          <Text className="mt-3.5 mx-auto mb-section max-w-112.5">
            Configure a write and verify benchmark. Measured results will appear
            here as SPT runs.
          </Text>
          <Button variant="filled" onClick={onConfigure}>
            Configure a run
          </Button>
        </Paper>
      ) : (
        <>
          <section
            className="px-panel py-comfortable flex flex-wrap items-center gap-xl border-[0.0625rem] border-border rounded-lg bg-panel mb-panel max-[71.875rem]:gap-comfortable max-[47.5rem]:p-md"
            aria-label="Run status"
          >
            <div className="grid gap-1.75">
              <span className="text-caption/[inherit] text-subtle">Status</span>
              <Status status={job?.status ?? "recorded"} />
            </div>
            <div className="grid gap-1.75">
              <span className="text-caption/[inherit] text-subtle">
                Elapsed
              </span>
              <strong className="text-sm/[inherit] font-semibold">
                {elapsed(job?.elapsed_seconds)}
              </strong>
            </div>
            <div className="grid gap-1.75">
              <span className="text-caption/[inherit] text-subtle">
                Current phase
              </span>
              <strong className="text-sm/[inherit] font-semibold">
                {job?.phase || phaseName(m?.phase)}
              </strong>
            </div>
            <div className="grid gap-1.75">
              <span className="text-caption/[inherit] text-subtle">
                Workload
              </span>
              <strong className="text-sm/[inherit] font-semibold">
                {workloadLabel(runWorkloadType(m, job))}
              </strong>
            </div>
            <div className="flex-1 min-w-35 grid gap-1.75 max-[47.5rem]:basis-full">
              <div className="flex flex-wrap justify-between gap-3.75">
                <span className="text-caption/[inherit] text-subtle">
                  Reported phase progress
                </span>
                <strong className="text-sm/[inherit] font-semibold">
                  {progress === null ? "Not reported" : `${fmt(progress, 1)}%`}
                </strong>
              </div>
              {progress !== null && (
                <Progress
                  value={Math.max(0, Math.min(100, progress))}
                  aria-label="Reported phase progress"
                />
              )}
            </div>
          </section>
          <Paper
            component="section"
            className="mb-panel p-panel max-[47.5rem]:p-4.25 flex items-center justify-between gap-section max-[71.875rem]:flex-col max-[71.875rem]:items-start"
          >
            <div>
              <span className="block text-xs/[inherit] tracking-[0.08125rem] text-[#6b7f99] font-heading mb-1.75">
                RUN OUTCOME
              </span>
              <Title order={2}>{outcome}</Title>
              <Text size="sm" className="mt-1.75">
                {job?.message ||
                  "SPT measurements from the configured storage target."}
              </Text>
            </div>
            <div className="flex flex-wrap gap-wide shrink-0 max-[47.5rem]:gap-panel">
              <span className="grid gap-1.75 text-muted text-xs/[inherit]">
                Failed operations
                <strong className="text-foreground text-lg/[inherit]">
                  {fmt(failureCount)}
                </strong>
                <small className="font-normal max-w-37.5 text-xs/[inherit]">
                  {numeric(m?.total_failed) !== null
                    ? "Across all recorded phases"
                    : `In ${phaseName(selectedPhase).toLowerCase()} phase`}
                </small>
              </span>
              <span className="grid gap-1.75 text-muted text-xs/[inherit]">
                History captured
                <strong className="text-foreground text-lg/[inherit]">
                  {history.length} samples
                </strong>
                <small className="font-normal max-w-37.5 text-xs/[inherit]">
                  Reported interval measurements
                </small>
              </span>
            </div>
          </Paper>

          <RunWarnings warnings={m?.warnings} />

          {m && (
            <>
              <div className="flex flex-wrap gap-lg items-center mb-comfortable">
                <NativeSelect
                  label="Inspect phase"
                  value={selectedPhase}
                  onChange={(e) => setPhase(e.target.value)}
                  data={available.map((p) => ({
                    value: p,
                    label: phaseName(p),
                  }))}
                  className="min-w-40"
                />
                <Text size="caption">
                  {!m.is_active && final
                    ? "Final phase averages"
                    : "Latest measured phase snapshot"}{" "}
                  · Missing values appear as —
                </Text>
              </div>
              {has("cards") && (
                <div className="grid grid-cols-4 gap-md mb-panel max-[47.5rem]:grid-cols-2 max-[47.5rem]:gap-sm">
                  <MetricCard
                    label={`${phaseName(selectedPhase)} IOPS`}
                    value={formatMetric(
                      row?.interval_iops,
                      2,
                      m.is_active ? m.data_status : undefined,
                    )}
                    unit="ops/s"
                    detail={
                      !m.is_active && final
                        ? "Average successful operations per second"
                        : !row && m.data_status === "no_data"
                          ? "No live sample yet — not a measured zero"
                          : "Latest reported rate of successful operations"
                    }
                  />
                  <MetricCard
                    label="Bandwidth"
                    value={formatMetric(
                      row?.bandwidth_mib_s,
                      2,
                      m.is_active ? m.data_status : undefined,
                    )}
                    unit="MiB/s"
                    detail="Data transferred per second"
                    accent="teal"
                  />
                  <MetricCard
                    label="P50 latency"
                    value={formatMetric(
                      row?.p50_latency_us,
                      1,
                      m.is_active ? m.data_status : undefined,
                    )}
                    unit="µs"
                    detail="Half of measured operations were faster"
                    accent="purple"
                  />
                  <MetricCard
                    label="Successful operations"
                    value={formatMetric(
                      row?.cumulative_ops,
                      0,
                      m.is_active ? m.data_status : undefined,
                    )}
                    detail={`In ${phaseName(selectedPhase).toLowerCase()} phase · ${formatMetric(row?.count_failed, 0, m.is_active ? m.data_status : undefined)} failed`}
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
              {!historical && m?.nodes && <NodeTable nodes={m.nodes} />}
            </>
          )}
          {job?.run_id && (
            <RunLog
              key={job.run_id}
              base={`/api/runs/${encodeURIComponent(job.run_id)}/log`}
              sources={["console", "results"]}
              title="Errors and logs"
              collapsed
              refreshMs={job.status === "running" ? 3000 : 0}
            />
          )}
          {has("record") && (
            <Accordion mb="panel">
              <Accordion.Item value="section">
                <Accordion.Control>Run record and settings</Accordion.Control>
                <Accordion.Panel>
                  <div className="mx-0 my-panel flex flex-wrap gap-panel text-caption/[inherit] text-muted">
                    <span>Started: {utc(job?.started_at)}</span>
                    <span>Finished: {utc(job?.finished_at)}</span>
                    <span>Exit code: {fmt(job?.returncode)}</span>
                  </div>
                  <dl className="grid grid-cols-2 gap-lg max-[47.5rem]:grid-cols-1">
                    <div>
                      <dt className="text-muted text-caption/[inherit] mb-1.75">
                        Objects
                      </dt>
                      <dd className="m-0 text-control/[inherit] font-semibold wrap-anywhere">
                        {fmt(job?.options?.object_count)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted text-caption/[inherit] mb-1.75">
                        Object size
                      </dt>
                      <dd className="m-0 text-control/[inherit] font-semibold wrap-anywhere">
                        {job?.options?.object_size ?? "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted text-caption/[inherit] mb-1.75">
                        Threads
                      </dt>
                      <dd className="m-0 text-control/[inherit] font-semibold wrap-anywhere">
                        {fmt(job?.options?.threads)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted text-caption/[inherit] mb-1.75">
                        Safety time limit
                      </dt>
                      <dd className="m-0 text-control/[inherit] font-semibold wrap-anywhere">
                        {elapsed(job?.options?.max_runtime_seconds)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted text-caption/[inherit] mb-1.75">
                        Run prefix
                      </dt>
                      <dd className="m-0 text-control/[inherit] font-semibold wrap-anywhere">
                        {job?.prefix ?? "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted text-caption/[inherit] mb-1.75">
                        Source
                      </dt>
                      <dd className="m-0 text-control/[inherit] font-semibold wrap-anywhere">
                        {m?.source_file ?? "—"}
                      </dd>
                    </div>
                  </dl>
                </Accordion.Panel>
              </Accordion.Item>
            </Accordion>
          )}
        </>
      )}
    </>
  );
}
