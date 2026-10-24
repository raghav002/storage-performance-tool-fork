import { useEffect, useState } from "react";
import type { Driver, Options, RunMode, State } from "../types";
import { defaults } from "../config";
import { StorageConfiguration } from "./StorageConfiguration";
import { Status } from "./Status";
import { formatNumber as fmt } from "../utils/metrics";
import { driverReadiness } from "../utils/driver";
import {
  fallbackLimits,
  readJSON,
  formatBytes,
  parseSize,
  parseWhole,
  sizeUnits,
  splitSize,
  validateOptions,
  type OptionErrors,
  type SizeUnit,
} from "../utils/validation";

type ExpertDraft = {
  object_count: string;
  size_amount: string;
  size_unit: SizeUnit;
  threads: string;
  max_runtime_seconds: string;
};
const expertPresets: { label: string; options: Options }[] = [
  {
    label: "Quick check",
    options: {
      object_count: 100,
      object_size: "1MiB",
      threads: 2,
      max_runtime_seconds: 60,
    },
  },
  {
    label: "Medium",
    options: {
      object_count: 2000,
      object_size: "4MiB",
      threads: 8,
      max_runtime_seconds: 600,
    },
  },
  {
    label: "Sustained",
    options: {
      object_count: 5000,
      object_size: "16MiB",
      threads: 32,
      max_runtime_seconds: 1800,
    },
  },
];
function toDraft(o: Options): ExpertDraft {
  const { amount, unit } = splitSize(o.object_size);
  return {
    object_count: String(o.object_count),
    size_amount: amount,
    size_unit: unit,
    threads: String(o.threads),
    max_runtime_seconds: String(o.max_runtime_seconds),
  };
}
function fromDraft(d: ExpertDraft): Options {
  return {
    mode: "expert",
    object_count: parseWhole(d.object_count) ?? NaN,
    object_size: `${d.size_amount.trim()}${d.size_unit}`,
    threads: parseWhole(d.threads) ?? NaN,
    max_runtime_seconds: parseWhole(d.max_runtime_seconds) ?? NaN,
  };
}

export function Configure({
  state,
  mode,
  offline,
  onRefresh,
  onStarted,
}: {
  state: State | null;
  mode: RunMode;
  offline: boolean;
  onRefresh: () => Promise<void>;
  onStarted: () => Promise<void>;
}) {
  const [guided, setGuided] = useState<Options>({ ...defaults }),
    [draft, setDraft] = useState<ExpertDraft>(() => toDraft(defaults)),
    [review, setReview] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [storageDirty, setStorageDirty] = useState(false),
    [driver, setDriver] = useState<Driver>("s3");
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
  // Each mode keeps its own values; a mode change returns to editing.
  useEffect(() => setReview(false), [mode]);
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
  async function start() {
    if (busy || !ready || !valid) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      await readJSON(r, "Run request failed.");
      await onStarted();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start run.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="configure">
      <span className="eyebrow">NEW BENCHMARK</span>
      <h1>Configure a run</h1>
      <p>
        Write test objects, read them back to verify integrity, then clean up
        the run’s objects.
      </p>
      {state?.job?.status === "running" && (
        <div className="notice">
          A run is already in progress. Its results are available in Live
          dashboard.
        </div>
      )}
      <section className="panel">
        <span className="eyebrow">STEP 1</span>
        <h2>Storage configuration</h2>
        <StorageConfiguration
          state={state}
          offline={offline}
          onDirty={setStorageDirty}
          onRefresh={onRefresh}
        />
      </section>
      <section className="panel">
        <span className="eyebrow">STEP 2</span>
        <h2>{review ? "Review your run" : "Workload configuration"}</h2>
        <div
          className="driver-switch"
          role="radiogroup"
          aria-label="Storage driver"
        >
          {(
            [
              [
                "s3",
                "S3 write + verify",
                "Writes, reads back, and cleans up objects in the configured bucket.",
              ],
              [
                "mock",
                "Mock driver",
                "Runs SPT's mock storage driver. No S3 endpoint or credentials are used; for smoke tests only.",
              ],
            ] as const
          ).map(([value, label, help]) => (
            <label key={value} className="check-label">
              <input
                type="radio"
                name="driver"
                value={value}
                checked={driver === value}
                disabled={busy}
                onChange={() => {
                  setDriver(value);
                  setReview(false);
                }}
              />
              <div>
                <strong>{label}</strong>
                <p>{help}</p>
              </div>
            </label>
          ))}
        </div>
        {!verified && (
          <div className="notice">
            {driver === "mock"
              ? "Verify the client machines to unlock workload settings. The S3 endpoint check is not needed for a mock run."
              : "Verify the storage configuration to unlock workload settings."}
          </div>
        )}
        {driver === "mock" && !!state?.target.mock_reasons?.length && (
          <div className="notice notice-warn">
            {state.target.mock_reasons.join(" ")}
          </div>
        )}
        <fieldset className="plain-fieldset" disabled={!verified}>
          {review ? (
            <>
              <div className="review">
                <h2>
                  {driver === "mock" ? "Mock driver" : "Write + verify"} ·{" "}
                  {mode === "expert" ? "Expert" : "Guided"} · {clients} client
                  machine
                  {clients === 1 ? "" : "s"}
                </h2>
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
                {driver === "mock" ? (
                  <p>
                    Mock run: no data is written to S3. Results show SPT's mock
                    driver, not storage performance.
                  </p>
                ) : (
                  <p>
                    Up to {fmt(totalBytes / 1048576, 2)} MiB of test data. A
                    unique prefix isolates this run. Cleanup is best effort.
                  </p>
                )}
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
                {driver === "mock"
                  ? "Starting runs SPT with the mock driver on the verified client machines."
                  : "Starting runs a real benchmark on the configured storage target."}
              </p>
            </>
          ) : (
            <form
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                if (valid) setReview(true);
              }}
            >
              <p className="form-help">
                {mode === "expert"
                  ? "Expert mode: enter any values within the server's limits."
                  : "Guided mode: choose from preset sizes for short, safe runs. Switch to Expert in the top bar for custom values."}
              </p>
              {mode === "expert" ? (
                <ExpertFields
                  draft={draft}
                  setDraft={setDraft}
                  errors={errors}
                  limits={limits}
                />
              ) : (
                <GuidedFields
                  config={guided}
                  setConfig={setGuided}
                  errors={errors}
                  limits={limits}
                />
              )}
              <div
                className={`notice ${totalBytes > limits.expert.max_total_bytes * 0.8 ? "notice-warn" : ""}`}
              >
                Maximum test data:{" "}
                <strong>{fmt(totalBytes / 1048576, 2)} MiB</strong>
                {mode === "expert" &&
                  ` of ${formatBytes(limits.expert.max_total_bytes)} allowed`}{" "}
                · Unique prefix · Best effort cleanup
              </div>
              <button className="primary" type="submit" disabled={!valid}>
                Review run
              </button>
            </form>
          )}
        </fieldset>
        {error && (
          <div className="error run-error" role="alert">
            {error}
          </div>
        )}
      </section>
    </div>
  );
}

function FieldHint({
  id,
  error,
  hint,
}: {
  id: string;
  error?: string;
  hint: string;
}) {
  return error ? (
    <small id={id} className="field-error" role="alert">
      {error}
    </small>
  ) : (
    <small id={id}>{hint}</small>
  );
}

function GuidedFields({
  config,
  setConfig,
  errors,
  limits,
}: {
  config: Options;
  setConfig: (o: Options) => void;
  errors: OptionErrors;
  limits: NonNullable<State["limits"]>;
}) {
  const g = limits.guided;
  const select = (
    key: "object_count" | "threads" | "max_runtime_seconds",
    label: string,
    values: number[],
    hint: string,
    suffix = "",
  ) => (
    <label>
      {label}
      <select
        value={config[key]}
        aria-invalid={!!errors[key]}
        aria-describedby={`guided-${key}-hint`}
        onChange={(e) =>
          setConfig({ ...config, [key]: Number(e.target.value) })
        }
      >
        {values.map((v) => (
          <option key={v} value={v}>
            {v}
            {suffix}
          </option>
        ))}
      </select>
      <FieldHint id={`guided-${key}-hint`} error={errors[key]} hint={hint} />
    </label>
  );
  return (
    <div className="form-grid">
      {select(
        "object_count",
        "Maximum objects",
        g.object_counts,
        "Stop after this many objects.",
      )}
      <label>
        Object size
        <select
          value={config.object_size}
          aria-invalid={!!errors.object_size}
          aria-describedby="guided-object_size-hint"
          onChange={(e) =>
            setConfig({ ...config, object_size: e.target.value })
          }
        >
          {g.object_sizes.map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
        <FieldHint
          id="guided-object_size-hint"
          error={errors.object_size}
          hint="Size of each test object."
        />
      </label>
      {select(
        "threads",
        "Parallel threads",
        g.threads,
        "Concurrent requests from each client machine.",
      )}
      {select(
        "max_runtime_seconds",
        "Safety time limit",
        g.max_runtime_seconds,
        "Maximum configured runtime.",
        " seconds",
      )}
    </div>
  );
}

function ExpertFields({
  draft,
  setDraft,
  errors,
  limits,
}: {
  draft: ExpertDraft;
  setDraft: (d: ExpertDraft) => void;
  errors: OptionErrors;
  limits: NonNullable<State["limits"]>;
}) {
  const e = limits.expert;
  const number = (
    key: "object_count" | "threads" | "max_runtime_seconds",
    label: string,
    range: { min: number; max: number },
    hint: string,
  ) => (
    <label>
      {label}
      <input
        type="number"
        inputMode="numeric"
        min={range.min}
        max={range.max}
        step={1}
        value={draft[key]}
        aria-invalid={!!errors[key]}
        aria-describedby={`expert-${key}-hint`}
        onChange={(ev) => setDraft({ ...draft, [key]: ev.target.value })}
      />
      <FieldHint id={`expert-${key}-hint`} error={errors[key]} hint={hint} />
    </label>
  );
  return (
    <>
      <div className="preset-chips" role="group" aria-label="Starting points">
        {expertPresets.map((p) => (
          <button
            type="button"
            key={p.label}
            onClick={() => setDraft(toDraft(p.options))}
          >
            {p.label}
            <small>
              {p.options.object_count.toLocaleString("en-US")} ×{" "}
              {p.options.object_size} · {p.options.threads} threads
            </small>
          </button>
        ))}
      </div>
      <div className="form-grid">
        {number(
          "object_count",
          "Maximum objects",
          e.object_count,
          `${e.object_count.min}–${e.object_count.max.toLocaleString("en-US")} objects.`,
        )}
        <label>
          Object size
          <span className="size-input">
            <input
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={draft.size_amount}
              aria-label="Object size amount"
              aria-invalid={!!errors.object_size}
              aria-describedby="expert-object_size-hint"
              onChange={(ev) =>
                setDraft({ ...draft, size_amount: ev.target.value })
              }
            />
            <select
              value={draft.size_unit}
              aria-label="Object size unit"
              onChange={(ev) =>
                setDraft({ ...draft, size_unit: ev.target.value as SizeUnit })
              }
            >
              {Object.keys(sizeUnits).map((u) => (
                <option key={u}>{u}</option>
              ))}
            </select>
          </span>
          <FieldHint
            id="expert-object_size-hint"
            error={errors.object_size}
            hint={`${formatBytes(e.object_size_bytes.min)}–${formatBytes(e.object_size_bytes.max)} per object.`}
          />
        </label>
        {number(
          "threads",
          "Parallel threads",
          e.threads,
          `${e.threads.min}–${e.threads.max} concurrent requests per client machine.`,
        )}
        {number(
          "max_runtime_seconds",
          "Safety time limit (seconds)",
          e.max_runtime_seconds,
          `${e.max_runtime_seconds.min}–${e.max_runtime_seconds.max} seconds.`,
        )}
      </div>
    </>
  );
}
