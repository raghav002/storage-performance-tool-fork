import { Button, Text, Title } from "@mantine/core";
import { Plus, Square } from "lucide-react";
import type { State } from "../../types";

export function DashboardHeader({
  state,
  historical,
  onBackHistory,
  canStop,
  stopPending,
  onStop,
  onConfigure,
}: {
  state: State | null;
  historical: boolean;
  onBackHistory?: () => void;
  canStop: boolean;
  stopPending: boolean;
  onStop: () => void;
  onConfigure: () => void;
}) {
  const job = state?.job,
    m = state?.metrics;
  const summaries = m?.phase_summaries ?? [];
  return (
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
            onClick={onStop}
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
  );
}
