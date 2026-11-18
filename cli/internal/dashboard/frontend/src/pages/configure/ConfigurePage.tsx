import {
  Alert,
  Button,
  Fieldset,
  Paper,
  Radio,
  Text,
  Title,
} from "@mantine/core";
import { useState } from "react";
import type { Options, RunMode, State } from "../../types";
import { useStartRun } from "../../api/mutations";
import { defaults } from "../../config";
import { formatNumber as fmt } from "../../utils/metrics";
import { driverReadiness } from "../../utils/driver";
import {
  fallbackLimits,
  formatBytes,
  parseSize,
  validateOptions,
  type OptionErrors,
} from "../../utils/validation";
import {
  advancedDefaults,
  appliedWorkloads,
  changedFlags,
  runFlags,
  driverForWorkload,
  workloadRequest,
  type FlagValue,
  type Workload,
} from "../../flags/schema";
import { validateAdvanced } from "../../flags/validate";
import { fromDraft, toDraft, type ExpertDraft } from "./configuration";

type AdvancedValues = Record<string, FlagValue>;
import { ExpertWorkspace } from "./ExpertWorkspace";
import { GuidedFields } from "./GuidedFields";
import { RunReview } from "./RunReview";
import { StorageConfiguration } from "./StorageConfiguration";

export function ConfigurePage({
  state,
  mode,
  offline,
  onStarted,
}: {
  state: State | null;
  mode: RunMode;
  offline: boolean;
  onStarted: () => void;
}) {
  const [guided, setGuided] = useState<Options>({ ...defaults }),
    [draft, setDraft] = useState<ExpertDraft>(() => toDraft(defaults)),
    [review, setReview] = useState(false),
    [storageDirty, setStorageDirty] = useState(false),
    [workload, setWorkload] = useState<Workload>("write-verify"),
    // Expert flags, kept per workload so switching keeps each one's values.
    // Sent with a run only for workloads whose flags the server applies.
    [advancedByWorkload, setAdvancedByWorkload] = useState<
      Record<Workload, AdvancedValues>
    >(() => ({
      "write-verify": advancedDefaults("write-verify"),
      write: advancedDefaults("write"),
      mock: advancedDefaults("mock"),
    }));
  // Only mock runs on SPT's mock driver; both S3 workloads need verified storage.
  const driver = driverForWorkload(workload);
  const advanced = advancedByWorkload[workload];
  const setAdvanced = (w: Workload, values: AdvancedValues) =>
    setAdvancedByWorkload((all) => ({ ...all, [w]: values }));
  const startMutation = useStartRun();
  const busy = startMutation.isPending;
  const error = startMutation.error?.message ?? "";
  const limits = state?.limits ?? fallbackLimits;
  // Expert flags reach the run only where the server applies them.
  const applied = mode === "expert" && appliedWorkloads.has(workload);
  const flags = applied ? runFlags(workload, advanced) : {};
  const config: Options = {
    ...(mode === "expert" ? fromDraft(draft) : { ...guided, mode: "guided" }),
    ...workloadRequest(workload),
    ...(Object.keys(flags).length ? { flags } : {}),
  };
  const errors: OptionErrors = validateOptions(config, limits);
  const advancedErrors = validateAdvanced(
    workload,
    advanced,
    config.object_size,
  );
  // Applied flags must be valid to start a run; preview-only ones never block.
  const valid =
    Object.keys(errors).length === 0 &&
    (!applied || Object.keys(advancedErrors).length === 0);
  const previewOnly =
    mode === "expert" && !applied ? changedFlags(workload, advanced) : [];
  const appliedFlags = applied ? changedFlags(workload, advanced) : [];
  const totalBytes =
    (parseSize(config.object_size) ?? 0) *
    (Number.isFinite(config.object_count) ? config.object_count : 0);

  const [previousMode, setPreviousMode] = useState(mode);
  if (mode !== previousMode) {
    setPreviousMode(mode);
    setReview(false);
  }
  const clients = state?.storage?.hosts.length ?? 1;
  const { verified, targetReady } = driverReadiness(
    driver,
    state,
    storageDirty,
  );
  const ready =
    targetReady &&
    !offline &&
    state?.job?.status !== "running" &&
    verified &&
    valid;
  function start() {
    if (busy || !ready || !valid) return;
    startMutation.mutate(config, { onSuccess: onStarted });
  }
  return (
    <div
      className={`mx-auto my-3.75 ${mode === "expert" ? "max-w-302.5" : "max-w-200"}`}
    >
      <span className="block text-xs/[inherit] tracking-[0.08125rem] text-[#6b7f99] font-heading mb-compact">
        NEW BENCHMARK
      </span>
      <Title order={1}>Configure a run</Title>
      <Text className="mt-compact mb-section">
        Choose where SPT runs and what it does: write and verify, write only, or
        exercise the mock driver.
      </Text>
      {state?.job?.status === "running" && (
        <Alert role="note">
          A run is already in progress. Its results are available in Live
          dashboard.
        </Alert>
      )}
      <Paper
        component="section"
        className="mb-panel p-panel max-[47.5rem]:p-4.25"
      >
        <span className="block text-xs/[inherit] tracking-[0.08125rem] text-[#6b7f99] font-heading mb-compact">
          STEP 1
        </span>
        <Title order={2}>Storage configuration</Title>
        <StorageConfiguration
          state={state}
          offline={offline}
          onDirty={setStorageDirty}
        />
      </Paper>
      <Paper
        component="section"
        className="mb-panel p-panel max-[47.5rem]:p-4.25"
      >
        <span className="block text-xs/[inherit] tracking-[0.08125rem] text-[#6b7f99] font-heading mb-compact">
          STEP 2
        </span>
        <Title order={2}>
          {review ? "Review your run" : "Workload configuration"}
        </Title>
        <Radio.Group
          name="workload"
          label="Workload"
          labelProps={{ className: "sr-only" }}
          value={workload}
          disabled={busy}
          onChange={(value) => {
            setWorkload(value as Workload);
            setReview(false);
          }}
        >
          <div className="my-comfortable grid grid-cols-[repeat(auto-fit,minmax(min(15rem,100%),1fr))] gap-sm">
            <Radio
              value="write-verify"
              label="S3 write + verify"
              description="Writes, reads back, and cleans up objects in the configured bucket."
            />
            <Radio
              value="write"
              label="S3 write"
              description="Writes objects to the configured bucket without reading them back, then cleans them up."
            />
            <Radio
              value="mock"
              label="Mock driver"
              description="Runs SPT's mock storage driver. No S3 endpoint or credentials are used; for smoke tests only."
            />
          </div>
        </Radio.Group>
        {!verified && (
          <Alert role="note">
            {driver === "mock"
              ? "Verify the client machines to unlock workload settings. The S3 endpoint check is not needed for a mock run."
              : "Verify the storage configuration to unlock workload settings."}
          </Alert>
        )}
        {driver === "mock" && !!state?.target.mock_reasons?.length && (
          <Alert color="yellow" role="note">
            {state.target.mock_reasons.join(" ")}
          </Alert>
        )}
        <Fieldset disabled={!verified}>
          {review ? (
            <RunReview
              config={config}
              workload={workload}
              mode={mode}
              clients={clients}
              totalBytes={totalBytes}
              draft={draft}
              advanced={advanced}
              advancedValid={Object.keys(advancedErrors).length === 0}
              previewOnly={previewOnly}
              appliedFlags={appliedFlags}
              busy={busy}
              ready={ready}
              onEdit={() => setReview(false)}
              onStart={start}
            />
          ) : (
            <form
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                if (valid) setReview(true);
              }}
            >
              <Text size="sm" className="my-comfortable">
                {mode === "expert"
                  ? "Expert mode: enter any values within the server's limits."
                  : "Guided mode: choose from preset sizes for short, safe runs. Switch to Expert in the top bar for custom values."}
              </Text>
              {mode === "expert" ? (
                <ExpertWorkspace
                  draft={draft}
                  setDraft={setDraft}
                  errors={errors}
                  limits={limits}
                  verified={verified}
                  clients={clients}
                  workload={workload}
                  setWorkload={(w) => {
                    setWorkload(w);
                    setReview(false);
                  }}
                  advanced={advanced}
                  setAdvanced={setAdvanced}
                  advancedErrors={advancedErrors}
                />
              ) : (
                <GuidedFields
                  config={guided}
                  setConfig={setGuided}
                  errors={errors}
                  limits={limits}
                />
              )}
              <Alert
                color={
                  totalBytes > limits.expert.max_total_bytes * 0.8
                    ? "yellow"
                    : "spt"
                }
                role="note"
              >
                Maximum test data:{" "}
                <strong>{fmt(totalBytes / 1048576, 2)} MiB</strong>
                {mode === "expert" &&
                  ` of ${formatBytes(limits.expert.max_total_bytes)} allowed`}{" "}
                · Unique prefix · Best effort cleanup
              </Alert>
              <Button variant="filled" type="submit" disabled={!valid}>
                Review run
              </Button>
            </form>
          )}
        </Fieldset>
        {error && (
          <Alert color="red" role="alert" mt="lg">
            {error}
          </Alert>
        )}
      </Paper>
    </div>
  );
}
