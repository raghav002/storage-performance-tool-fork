import { Alert, Button, NativeSelect, Paper, Text, Title } from "@mantine/core";
import { LayoutDashboard } from "lucide-react";
import { useState } from "react";
import type { Row, State } from "../../types";
import { useStopRun } from "../../api/mutations";
import { MetricCard } from "../../components/MetricCard";
import { PerformanceLimits } from "../../components/PerformanceLimits";
import { MeasuredDetails, PhaseResults } from "../../components/RunMetrics";
import { Charts } from "../../components/RunCharts";
import { NodeTable } from "../../components/NodeTable";
import { RunWarnings } from "../../components/RunWarnings";
import { RunLog } from "../../components/RunLog";
import {
  formatMetric,
  numeric,
  phaseCode,
  phaseName,
} from "../../utils/metrics";
import { DashboardHeader } from "./DashboardHeader";
import { RunOverview } from "./RunOverview";
import { RunRecord } from "./RunRecord";

export function DashboardPage({
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
    if (!canStop || stopPending || !job) return;
    // Capture the run now: the page may move on to a newer run while the
    // confirmation is open, and the server only stops the run named here.
    const runID = job.run_id;
    if (
      window.confirm(
        "Stop this run? It ends now and won't finish its remaining phases.",
      )
    ) {
      stopping.mutate(runID);
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
      <DashboardHeader
        state={state}
        historical={historical}
        onBackHistory={onBackHistory}
        canStop={canStop}
        stopPending={stopPending}
        onStop={stop}
        onConfigure={onConfigure}
      />
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
          <RunOverview
            state={state}
            progress={progress}
            outcome={outcome}
            failureCount={failureCount}
            historyCount={history.length}
            selectedPhase={selectedPhase}
          />
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
                    ? "Final phase summary"
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
          {has("record") && <RunRecord job={job} metrics={m} />}
        </>
      )}
    </>
  );
}
