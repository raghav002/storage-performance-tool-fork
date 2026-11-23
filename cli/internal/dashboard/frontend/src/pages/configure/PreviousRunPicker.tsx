import { Button, NativeSelect } from "@mantine/core";
import { useState } from "react";
import type { Options } from "../../types";
import { useRuns } from "../../api/queries";
import { cleanAdvanced } from "../../flags/profiles";
import {
  workloadName,
  workloadOfRequest,
  type FlagValue,
  type Workload,
} from "../../flags/schema";
import { toDraft, type ExpertDraft } from "./configuration";

// A completed run's settings, as expert mode applies them: its workload, the
// four core settings and every flag it ran with (the rest at their defaults).
export type DuplicatedRun = {
  workload: Workload;
  draft: ExpertDraft;
  advanced: Record<string, FlagValue>;
};

export function PreviousRunPicker({
  onDuplicate,
}: {
  onDuplicate: (run: DuplicatedRun) => void;
}) {
  const history = useRuns();
  const previousRuns = (
    Array.isArray(history.data?.runs) ? history.data.runs : []
  ).filter(
    (run) =>
      run.options &&
      run.status === "completed" &&
      typeof run.options.object_count === "number" &&
      typeof run.options.object_size === "string" &&
      typeof run.options.threads === "number" &&
      typeof run.options.max_runtime_seconds === "number",
  );
  const [chosenID, setChosenID] = useState("");
  const [message, setMessage] = useState("");
  const previousID = previousRuns.some((run) => run.run_id === chosenID)
    ? chosenID
    : (previousRuns[0]?.run_id ?? "");
  const historyMessage =
    history.error?.message ||
    message ||
    (history.isPending
      ? "Loading saved runs…"
      : previousRuns.length
        ? ""
        : "No completed runs with reusable settings found.");
  return (
    <div className="flex flex-wrap items-end gap-compact">
      <NativeSelect
        label="Completed benchmark"
        className="min-w-42.5 flex-1"
        value={previousID}
        onChange={(e) => setChosenID(e.target.value)}
      >
        {previousRuns.map((r) => (
          <option key={r.run_id} value={r.run_id}>
            {r.run_id} · {workloadName(workloadOfRequest(r.options))}
          </option>
        ))}
        {!previousRuns.length && <option value="">No runs available</option>}
      </NativeSelect>
      <Button
        size="xs"
        type="button"
        disabled={!previousID}
        onClick={() => {
          const selected = previousRuns.find((r) => r.run_id === previousID);
          if (selected?.options) {
            const workload = workloadOfRequest(selected.options);
            // Saved flags are checked like a profile's: unknown, blocked or
            // invalid values fall back to their defaults.
            const advanced = cleanAdvanced(workload, selected.options.flags);
            onDuplicate({
              workload,
              draft: toDraft(selected.options as Options),
              advanced,
            });
            setMessage(
              `${workloadName(workload)} run settings loaded. Review them before running.`,
            );
          }
        }}
      >
        Duplicate settings
      </Button>
      {historyMessage && (
        <span role="status" className="text-caption/[inherit] text-[#738198]">
          {historyMessage}
        </span>
      )}
    </div>
  );
}
