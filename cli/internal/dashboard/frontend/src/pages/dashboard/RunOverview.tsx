import { Paper, Progress, Text, Title } from "@mantine/core";
import type { State } from "../../types";
import { Status } from "../../components/Status";
import { runWorkloadType, workloadLabel } from "../../utils/catalog";
import {
  elapsed,
  formatNumber as fmt,
  numeric,
  phaseName,
} from "../../utils/metrics";

export function RunOverview({
  state,
  progress,
  outcome,
  failureCount,
  historyCount,
  selectedPhase,
}: {
  state: State | null;
  progress: number | null;
  outcome: string;
  failureCount: number | null;
  historyCount: number;
  selectedPhase: string;
}) {
  const job = state?.job,
    m = state?.metrics;
  return (
    <>
      <section
        className="px-panel py-comfortable flex items-center gap-xl border-[0.0625rem] border-border rounded-lg bg-panel mb-panel max-[71.875rem]:gap-comfortable max-[47.5rem]:p-md max-[47.5rem]:flex-wrap"
        aria-label="Run status"
      >
        <div className="grid gap-1.75">
          <span className="text-caption/[inherit] text-subtle">Status</span>
          <Status status={job?.status ?? "recorded"} />
        </div>
        <div className="grid gap-1.75">
          <span className="text-caption/[inherit] text-subtle">Elapsed</span>
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
          <span className="text-caption/[inherit] text-subtle">Workload</span>
          <strong className="text-sm/[inherit] font-semibold">
            {workloadLabel(runWorkloadType(m, job))}
          </strong>
        </div>
        <div className="flex-1 min-w-35 grid gap-1.75 max-[47.5rem]:basis-full">
          <div className="flex justify-between gap-3.75">
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
              {historyCount} samples
            </strong>
            <small className="font-normal max-w-37.5 text-xs/[inherit]">
              Reported interval measurements
            </small>
          </span>
        </div>
      </Paper>
    </>
  );
}
