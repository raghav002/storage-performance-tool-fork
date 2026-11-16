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
import type { Driver, Options, RunMode, State } from "../../types";
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
import { fromDraft, toDraft, type ExpertDraft } from "./configuration";
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
    [driver, setDriver] = useState<Driver>("s3");
  const startMutation = useStartRun();
  const busy = startMutation.isPending;
  const error = startMutation.error?.message ?? "";
  const limits = state?.limits ?? fallbackLimits;
  const config: Options = {
    ...(mode === "expert" ? fromDraft(draft) : { ...guided, mode: "guided" }),
    ...(driver === "mock" ? { driver } : {}),
  };
  const errors: OptionErrors = validateOptions(config, limits);
  const valid = Object.keys(errors).length === 0;
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
        Write test objects, read them back to verify integrity, then clean up
        the run’s objects.
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
          name="driver"
          label="Storage driver"
          labelProps={{ className: "sr-only" }}
          value={driver}
          disabled={busy}
          onChange={(value) => {
            setDriver(value as Driver);
            setReview(false);
          }}
        >
          <div className="my-comfortable grid grid-cols-[repeat(auto-fit,minmax(min(15rem,100%),1fr))] gap-sm">
            <Radio
              value="s3"
              label="S3 write + verify"
              description="Writes, reads back, and cleans up objects in the configured bucket."
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
              driver={driver}
              mode={mode}
              clients={clients}
              totalBytes={totalBytes}
              draft={draft}
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
                  driver={driver}
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
