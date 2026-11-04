import { useEffect, useRef, useState } from "react";
import type { Driver, HistoryRun, Options, RunMode, State } from "../types";
import { defaults } from "../config";
import { StorageConfiguration } from "./StorageConfiguration";
import { Status } from "./Status";
import { formatNumber as fmt } from "../utils/metrics";
import { driverReadiness } from "../utils/driver";
import { buildSptCommand } from "../flags/command";
import {
  advancedDefaults,
  driverForWorkload,
  workloadForDriver,
  type FlagValue,
  type Workload,
} from "../flags/schema";
import { validateAdvanced, type FlagErrors } from "../flags/validate";
import {
  readProfiles,
  saveProfile as writeProfile,
  type ExpertProfile,
} from "../flags/profiles";
import { changedFlags, ExpertFlagGroups } from "./ExpertFlagGroups";
import {
  CommandPrompt,
  looksLikeSptCommand,
  reviewCommand,
  type CommandReview,
} from "./CommandPrompt";
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

type AdvancedValues = Record<string, FlagValue>;

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

type ExpertStart = "new" | "saved" | "previous" | "command";
// localStorage itself can throw, e.g. when the browser blocks site data.
function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readExpertProfiles(): ExpertProfile[] {
  const storage = browserStorage();
  return storage ? readProfiles(storage) : [];
}

// The equivalent spt run command, including the preview-only flags.
function expertCommand(
  draft: ExpertDraft,
  driver: Driver,
  advanced: AdvancedValues,
): string {
  return buildSptCommand(workloadForDriver(driver), fromDraft(draft), advanced);
}

function ExpertWorkspace({
  draft,
  setDraft,
  errors,
  limits,
  verified,
  clients,
  driver,
  setDriver,
  advanced,
  setAdvanced,
  advancedErrors,
}: {
  draft: ExpertDraft;
  setDraft: (d: ExpertDraft) => void;
  errors: OptionErrors;
  limits: NonNullable<State["limits"]>;
  verified: boolean;
  clients: number;
  driver: Driver;
  setDriver: (d: Driver) => void;
  advanced: AdvancedValues;
  setAdvanced: (workload: Workload, values: AdvancedValues) => void;
  advancedErrors: FlagErrors;
}) {
  const workload = workloadForDriver(driver);
  const workloadName = driver === "mock" ? "Mock driver" : "Write + verify";
  const advancedChanged = changedFlags(workload, advanced);
  const advancedValid = Object.keys(advancedErrors).length === 0;
  const [start, setStart] = useState<ExpertStart>("new");
  const [profiles, setProfiles] = useState(readExpertProfiles);
  const [chosenProfile, setChosenProfile] = useState("");
  const [profileName, setProfileName] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [previousRuns, setPreviousRuns] = useState<HistoryRun[]>([]);
  const [previousID, setPreviousID] = useState("");
  const [historyMessage, setHistoryMessage] = useState("");
  const [commandText, setCommandText] = useState("");
  const [commandReview, setCommandReview] = useState<CommandReview | null>(
    null,
  );
  const [appliedNote, setAppliedNote] = useState("");
  const workspaceRef = useRef<HTMLDivElement>(null);
  const options = fromDraft(draft);
  const valid = Object.keys(errors).length === 0;
  const changed = [
    ["object_count", "Object count"],
    ["object_size", "Object size"],
    ["threads", "Threads"],
    ["max_runtime_seconds", "Safety limit"],
  ].filter(
    ([key]) => options[key as keyof Options] !== defaults[key as keyof Options],
  );
  const volume =
    (parseSize(options.object_size) ?? 0) *
    (Number.isFinite(options.object_count) ? options.object_count : 0);

  useEffect(() => {
    if (start !== "previous") return;
    const controller = new AbortController();
    setHistoryMessage("Loading saved runs…");
    fetch("/api/runs", { cache: "no-store", signal: controller.signal })
      .then(async (response) =>
        readJSON(response, "Could not load saved runs."),
      )
      .then((data: { runs?: HistoryRun[] }) => {
        if (controller.signal.aborted) return;
        const available = (Array.isArray(data.runs) ? data.runs : []).filter(
          (r) =>
            r.options &&
            r.status === "completed" &&
            typeof r.options.object_count === "number" &&
            typeof r.options.object_size === "string" &&
            typeof r.options.threads === "number" &&
            typeof r.options.max_runtime_seconds === "number",
        );
        setPreviousRuns(available);
        setPreviousID(available[0]?.run_id ?? "");
        setHistoryMessage(
          available.length
            ? ""
            : "No completed runs with reusable settings found.",
        );
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setHistoryMessage(
            e instanceof Error ? e.message : "Unable to load run history.",
          );
      });
    return () => controller.abort();
  }, [start]);

  function saveProfile() {
    const name = profileName.trim().slice(0, 60);
    if (!name || !valid || !advancedValid) {
      setSaveMessage(
        name
          ? "Correct invalid settings before saving."
          : "Enter a profile name first.",
      );
      return;
    }
    try {
      const storage = browserStorage();
      if (!storage) throw new Error("unavailable");
      setProfiles(
        writeProfile(storage, profiles, { name, workload, options, advanced }),
      );
      setChosenProfile(name);
      setProfileName("");
      setSaveMessage(
        advancedChanged.length
          ? `Saved in this browser with ${advancedChanged.length} preview-only flag${advancedChanged.length === 1 ? "" : "s"}. Storage credentials are not saved.`
          : "Saved in this browser. Storage credentials are not saved.",
      );
    } catch {
      setSaveMessage(
        "Browser storage is unavailable. Could not save this profile.",
      );
    }
  }

  // Pasting an spt run command anywhere in expert mode asks whether to apply
  // it. Pastes into fields outside the workspace (e.g. storage settings) are
  // left alone; pastes into workspace fields do not land in the field.
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const text = e.clipboardData?.getData("text") ?? "";
      if (!looksLikeSptCommand(text)) return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      const inside = !!target && !!workspaceRef.current?.contains(target);
      const editable =
        !!target &&
        (target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
      if (!inside && editable) return;
      if (target?.id !== "expert-cli-input") e.preventDefault();
      setCommandReview((open) => open ?? reviewCommand(text, limits));
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [limits]);

  // The command replaces the whole expert configuration: workload, core
  // settings and every flag, with unmentioned settings back at their defaults.
  function applyCommand() {
    if (commandReview?.kind !== "apply") return;
    const { workload: next, options: core, advanced: flags } = commandReview;
    setDriver(driverForWorkload(next));
    setDraft(toDraft(core));
    setAdvanced(next, flags);
    const count = commandReview.settings.length;
    setAppliedNote(
      `Command applied: ${next === "mock" ? "Mock driver" : "Write + verify"}${count ? ` with ${count} flag${count === 1 ? "" : "s"}` : ""}. Settings not in the command were reset to their defaults.`,
    );
    setCommandReview(null);
  }

  return (
    <div className="expert-workspace" ref={workspaceRef}>
      <div className="expert-workspace-main">
        <div className="expert-area-heading">
          <strong>Start from</strong>
          <span>Reuse a known configuration or start with the defaults.</span>
        </div>
        <div
          className="expert-start-grid"
          role="group"
          aria-label="Start expert configuration"
        >
          {(
            [
              ["new", "New configuration", "Use a simple starting point"],
              ["saved", "Saved profile", "Reuse your browser profile"],
              ["previous", "Previous run", "Duplicate completed run settings"],
              ["command", "CLI command", "Import supported SPT flags"],
            ] as const
          ).map(([key, name, detail]) => (
            <button
              type="button"
              key={key}
              className={`expert-start-option ${start === key ? "active" : ""}`}
              aria-pressed={start === key}
              onClick={() => setStart(key)}
            >
              <strong>{name}</strong>
              <small>{detail}</small>
            </button>
          ))}
        </div>
        <div className="expert-starter">
          {start === "new" && (
            <div className="expert-inline">
              <label>
                Starting preset
                <select
                  defaultValue="default"
                  onChange={(e) => {
                    const preset = expertPresets.find(
                      (p) => p.label === e.target.value,
                    );
                    setDraft(toDraft(preset?.options ?? defaults));
                  }}
                >
                  <option value="default">Default · 100 objects, 64KiB</option>
                  {expertPresets.map((p) => (
                    <option key={p.label} value={p.label}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
              <span className="expert-muted">
                Adjust any setting below before reviewing.
              </span>
            </div>
          )}
          {start === "saved" && (
            <div className="expert-inline">
              <label>
                Saved configurations
                <select
                  value={chosenProfile}
                  onChange={(e) => setChosenProfile(e.target.value)}
                >
                  <option value="">Choose a saved profile</option>
                  {profiles.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name} ·{" "}
                      {p.workload === "mock" ? "Mock driver" : "Write + verify"}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={!chosenProfile}
                onClick={() => {
                  const p = profiles.find(
                    (item) => item.name === chosenProfile,
                  );
                  if (!p) return;
                  setDriver(driverForWorkload(p.workload));
                  setDraft(toDraft(p.options));
                  setAdvanced(p.workload, p.advanced);
                }}
              >
                Load profile
              </button>
              {!profiles.length && (
                <span className="expert-muted">
                  No saved profiles yet. Save one in the summary panel.
                </span>
              )}
            </div>
          )}
          {start === "previous" && (
            <div className="expert-inline">
              <label>
                Completed benchmark
                <select
                  value={previousID}
                  onChange={(e) => setPreviousID(e.target.value)}
                >
                  {previousRuns.map((r) => (
                    <option key={r.run_id} value={r.run_id}>
                      {r.run_id}
                    </option>
                  ))}
                  {!previousRuns.length && (
                    <option value="">No runs available</option>
                  )}
                </select>
              </label>
              <button
                type="button"
                disabled={!previousID}
                onClick={() => {
                  const selected = previousRuns.find(
                    (r) => r.run_id === previousID,
                  );
                  if (selected?.options) {
                    setDraft(toDraft(selected.options as Options));
                    setHistoryMessage(
                      "Previous run settings loaded. Review them before running.",
                    );
                  }
                }}
              >
                Duplicate settings
              </button>
              {historyMessage && (
                <span role="status" className="expert-muted">
                  {historyMessage}
                </span>
              )}
            </div>
          )}
          {start === "command" && (
            <div className="expert-command-import">
              <label htmlFor="expert-cli-input">Paste an SPT command</label>
              <textarea
                id="expert-cli-input"
                value={commandText}
                rows={3}
                spellCheck={false}
                placeholder="spt run write-verify --object-count 1000 --object-size 1MiB --threads 4 --auto-terminate-seconds 600"
                onChange={(e) => setCommandText(e.target.value)}
              />
              <div className="expert-inline">
                <button
                  type="button"
                  disabled={!commandText.trim()}
                  onClick={() =>
                    setCommandReview(reviewCommand(commandText, limits))
                  }
                >
                  Import command
                </button>
                <span className="expert-muted">
                  Commands are only read, never executed. Write-verify and mock
                  are supported. Tip: paste a command anywhere in Expert mode.
                </span>
              </div>
            </div>
          )}
        </div>
        {appliedNote && (
          <p className="expert-feedback-good" role="status">
            {appliedNote}
          </p>
        )}

        <div className="expert-area-heading expert-essentials-heading">
          <strong>{workloadName} · SPT flags</strong>
          <span>
            Open a group to change its flags. Each flag shows its SPT name and
            default.
          </span>
        </div>
        <ExpertFlagGroups
          workload={workload}
          coreChanged={changed.length}
          values={advanced}
          errors={advancedErrors}
          onChange={(values) => setAdvanced(workload, values)}
          core={
            <>
              <ExpertFields
                draft={draft}
                setDraft={setDraft}
                errors={errors}
                limits={limits}
                showPresets={false}
              />
              <details className="expert-limits">
                <summary>Host limits</summary>
                <p>The dashboard server enforces these limits on every run.</p>
                <dl>
                  <div>
                    <dt>Maximum objects</dt>
                    <dd>
                      {limits.expert.object_count.max.toLocaleString("en-US")}
                    </dd>
                  </div>
                  <div>
                    <dt>Maximum threads / client</dt>
                    <dd>{limits.expert.threads.max}</dd>
                  </div>
                  <div>
                    <dt>Maximum object size</dt>
                    <dd>{formatBytes(limits.expert.object_size_bytes.max)}</dd>
                  </div>
                  <div>
                    <dt>Maximum runtime</dt>
                    <dd>{limits.expert.max_runtime_seconds.max}s</dd>
                  </div>
                  <div>
                    <dt>Maximum data</dt>
                    <dd>{formatBytes(limits.expert.max_total_bytes)}</dd>
                  </div>
                </dl>
              </details>
            </>
          }
        />
      </div>
      <aside
        className="expert-summary"
        aria-label="Expert configuration summary"
      >
        <span className="eyebrow">CONFIGURATION SUMMARY</span>
        <h3>{workloadName}</h3>
        <span className="expert-summary-sub">
          {clients} client machine{clients === 1 ? "" : "s"} ·{" "}
          {driver === "mock"
            ? "No storage used"
            : verified
              ? "Storage verified"
              : "Storage not verified"}
        </span>
        <dl>
          <div>
            <dt>Maximum objects</dt>
            <dd>{draft.object_count || "—"}</dd>
          </div>
          <div>
            <dt>Object size</dt>
            <dd>
              {draft.size_amount
                ? `${draft.size_amount} ${draft.size_unit}`
                : "—"}
            </dd>
          </div>
          <div>
            <dt>Threads / client</dt>
            <dd>{draft.threads || "—"}</dd>
          </div>
          <div>
            <dt>Safety limit</dt>
            <dd>
              {draft.max_runtime_seconds
                ? `${draft.max_runtime_seconds}s`
                : "—"}
            </dd>
          </div>
        </dl>
        <div className="expert-data-footprint">
          <strong>Maximum test data</strong>
          <span>{Number.isFinite(volume) ? formatBytes(volume) : "—"}</span>
        </div>
        <div className="expert-changes">
          <strong>Modified from defaults</strong>
          <div className="expert-chips">
            {changed.length || advancedChanged.length ? (
              <>
                {changed.map(([, label]) => (
                  <span key={label}>{label}</span>
                ))}
                {advancedChanged.map((f) => (
                  <span key={f.name} className="preview">
                    {f.label}
                  </span>
                ))}
              </>
            ) : (
              <span className="quiet">Using defaults</span>
            )}
          </div>
        </div>
        <details className="expert-cli-preview">
          <summary>Preview CLI settings</summary>
          <pre>
            {valid && advancedValid
              ? expertCommand(draft, driver, advanced)
              : "Correct the settings to generate a command preview."}
          </pre>
          <small>
            {driver === "mock"
              ? "The Go backend adds the client machines, safe flags and the results directory. No storage credentials are passed."
              : "The Go backend adds storage credentials, safe flags and the results directory."}
            {advancedChanged.length > 0 &&
              " Dashboard runs apply only the four core settings; copy this command to run the rest with the SPT CLI."}
          </small>
        </details>
        <div className="expert-save">
          <label htmlFor="expert-profile-name">Save this configuration</label>
          <input
            id="expert-profile-name"
            value={profileName}
            placeholder="Profile name"
            maxLength={60}
            onChange={(e) => setProfileName(e.target.value)}
          />
          <button type="button" disabled={!valid} onClick={saveProfile}>
            Save profile
          </button>
          {saveMessage && <small role="status">{saveMessage}</small>}
        </div>
      </aside>
      {commandReview && (
        <CommandPrompt
          review={commandReview}
          currentWorkload={workload}
          onApply={applyCommand}
          onClose={() => setCommandReview(null)}
        />
      )}
    </div>
  );
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
    [driver, setDriver] = useState<Driver>("s3"),
    // Preview-only flags, kept per workload. Never sent with a run request.
    [advancedByWorkload, setAdvancedByWorkload] = useState<
      Record<Workload, AdvancedValues>
    >(() => ({
      "write-verify": advancedDefaults("write-verify"),
      mock: advancedDefaults("mock"),
    }));
  const workload = workloadForDriver(driver);
  const advanced = advancedByWorkload[workload];
  const setAdvanced = (w: Workload, values: AdvancedValues) =>
    setAdvancedByWorkload((all) => ({ ...all, [w]: values }));
  const limits = state?.limits ?? fallbackLimits;
  const config: Options = {
    ...(mode === "expert" ? fromDraft(draft) : { ...guided, mode: "guided" }),
    ...(driver === "mock" ? { driver } : {}),
  };
  const errors: OptionErrors = validateOptions(config, limits);
  const valid = Object.keys(errors).length === 0;
  // Advanced flags are not applied to runs, so their errors never block one.
  const advancedErrors = validateAdvanced(
    workload,
    advanced,
    config.object_size,
  );
  const previewOnly = mode === "expert" ? changedFlags(workload, advanced) : [];
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
    <div
      className={`configure ${mode === "expert" ? "configure--expert" : ""}`}
    >
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
                {previewOnly.length > 0 && (
                  <div className="notice notice-warn" role="note">
                    {previewOnly.length} preview-only flag
                    {previewOnly.length === 1 ? " is" : "s are"} set (
                    {previewOnly.map((f) => `--${f.name}`).join(", ")}). This
                    run applies only the four core settings; the other flags are
                    not sent.
                  </div>
                )}
                {mode === "expert" && (
                  <div className="expert-reviewed-command">
                    <strong>CLI settings preview</strong>
                    <pre>
                      {Object.keys(advancedErrors).length
                        ? "Correct the advanced flags to generate a command preview."
                        : expertCommand(draft, driver, advanced)}
                    </pre>
                    <small>
                      The server generates the complete command and validates
                      all options.
                    </small>
                  </div>
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
                <ExpertWorkspace
                  draft={draft}
                  setDraft={setDraft}
                  errors={errors}
                  limits={limits}
                  verified={verified}
                  clients={clients}
                  driver={driver}
                  setDriver={setDriver}
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
  showPresets = true,
}: {
  draft: ExpertDraft;
  setDraft: (d: ExpertDraft) => void;
  errors: OptionErrors;
  limits: NonNullable<State["limits"]>;
  showPresets?: boolean;
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
      {showPresets && (
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
      )}
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
