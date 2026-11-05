import {
  Accordion,
  Alert,
  Button,
  Code,
  Fieldset,
  Input,
  NativeSelect,
  Paper,
  Radio,
  Text,
  TextInput,
  Textarea,
  Title,
} from "@mantine/core";
import { useState } from "react";
import type { Driver, Options, RunMode, State } from "../types";
import { useStartRun } from "../api/mutations";
import { useRuns } from "../api/queries";
import { defaults } from "../config";
import { StorageConfiguration } from "./StorageConfiguration";
import { formatNumber as fmt } from "../utils/metrics";
import { driverReadiness } from "../utils/driver";
import {
  fallbackLimits,
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

type ExpertStart = "new" | "saved" | "previous" | "command";
type SavedExpertProfile = { name: string; options: Options };
const expertProfileStorageKey = "spt-dashboard-expert-profiles-v1";

function readExpertProfiles(): SavedExpertProfile[] {
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(expertProfileStorageKey) ?? "[]",
    );
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is SavedExpertProfile =>
          !!item &&
          typeof item === "object" &&
          typeof item.name === "string" &&
          !!item.options &&
          typeof item.options.object_count === "number" &&
          typeof item.options.object_size === "string" &&
          typeof item.options.threads === "number" &&
          typeof item.options.max_runtime_seconds === "number",
      )
      .slice(0, 12);
  } catch {
    return [];
  }
}

// Only parse the four settings currently accepted by POST /api/runs.
// Never execute user input or pass arbitrary CLI flags to the backend.
function parseExpertCommand(
  text: string,
  base: Options,
  limits: NonNullable<State["limits"]>,
): Options {
  const parts = text
    .replace(/\\\s*\r?\n/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (
    parts.length < 3 ||
    !["spt", "./spt"].includes(parts[0]) ||
    parts[1] !== "run" ||
    parts[2] !== "write-verify"
  ) {
    throw new Error("Start with: spt run write-verify");
  }
  const result: Options = { ...base, mode: "expert" };
  const map = {
    "--object-count": "object_count",
    "--object-size": "object_size",
    "--threads": "threads",
    "--auto-terminate-seconds": "max_runtime_seconds",
  } as const;
  const seen = new Set<string>();
  for (let i = 3; i < parts.length; i++) {
    const [flag, inline] = parts[i].split("=", 2);
    if (!(flag in map))
      throw new Error(
        `Unsupported flag: ${flag}. Only the four dashboard run settings can be imported.`,
      );
    if (seen.has(flag)) throw new Error(`Duplicate flag: ${flag}`);
    seen.add(flag);
    const value = inline ?? parts[++i];
    if (!value || value.startsWith("--"))
      throw new Error(`Missing value for ${flag}.`);
    const key = map[flag as keyof typeof map];
    if (key === "object_size") {
      result.object_size = value;
    } else {
      if (!/^\d+$/.test(value))
        throw new Error(`${flag} must be a whole number.`);
      result[key] = Number(value);
    }
  }
  if (seen.size === 0) throw new Error("Include at least one supported flag.");
  const errors = validateOptions(result, limits);
  const first = Object.values(errors).find(Boolean);
  if (first) throw new Error(first);
  return result;
}

function expertCommand(draft: ExpertDraft, driver: Driver): string {
  const opts = fromDraft(draft);
  const workload = driver === "mock" ? "mock" : "write-verify";
  return `spt run ${workload} --object-count ${opts.object_count} --object-size ${opts.object_size} --threads ${opts.threads} --auto-terminate-seconds ${opts.max_runtime_seconds}`;
}

function PreviousRunPicker({
  setDraft,
}: {
  setDraft: (draft: ExpertDraft) => void;
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
        className="min-w-[170px] flex-1"
        value={previousID}
        onChange={(e) => setChosenID(e.target.value)}
      >
        {previousRuns.map((r) => (
          <option key={r.run_id} value={r.run_id}>
            {r.run_id}
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
            setDraft(toDraft(selected.options as Options));
            setMessage(
              "Previous run settings loaded. Review them before running.",
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

function ExpertWorkspace({
  draft,
  setDraft,
  errors,
  limits,
  verified,
  clients,
  driver,
}: {
  draft: ExpertDraft;
  setDraft: (d: ExpertDraft) => void;
  errors: OptionErrors;
  limits: NonNullable<State["limits"]>;
  verified: boolean;
  clients: number;
  driver: Driver;
}) {
  const workloadName = driver === "mock" ? "Mock driver" : "Write + verify";
  const [start, setStart] = useState<ExpertStart>("new");
  const [profiles, setProfiles] = useState(readExpertProfiles);
  const [chosenProfile, setChosenProfile] = useState("");
  const [profileName, setProfileName] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [commandText, setCommandText] = useState("");
  const [commandMessage, setCommandMessage] = useState("");
  const [importError, setImportError] = useState(false);
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

  function saveProfile() {
    const name = profileName.trim().slice(0, 60);
    if (!name || !valid) {
      setSaveMessage(
        name
          ? "Correct invalid settings before saving."
          : "Enter a profile name first.",
      );
      return;
    }
    const next = [
      { name, options: { ...options, mode: "expert" as const } },
      ...profiles.filter((p) => p.name !== name),
    ].slice(0, 12);
    try {
      localStorage.setItem(expertProfileStorageKey, JSON.stringify(next));
      setProfiles(next);
      setChosenProfile(name);
      setProfileName("");
      setSaveMessage(
        "Saved in this browser. Storage credentials are not saved.",
      );
    } catch {
      setSaveMessage(
        "Browser storage is unavailable. Could not save this profile.",
      );
    }
  }

  function importCommand() {
    try {
      setDraft(toDraft(parseExpertCommand(commandText, options, limits)));
      setCommandMessage(
        "Supported settings imported. Review the fields and host limits below.",
      );
      setImportError(false);
    } catch (e) {
      setCommandMessage(
        e instanceof Error ? e.message : "Command could not be parsed.",
      );
      setImportError(true);
    }
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_275px] items-start gap-[25px] mt-panel [@media(max-width:1000px)]:grid-cols-1">
      <div className="min-w-0">
        <div className="flex flex-col gap-[5px]">
          <strong className="text-base/[inherit] text-foreground">
            Start from
          </strong>
          <span className="text-[#6b7b90] text-sm/[inherit]">
            Reuse a known configuration or start with the defaults.
          </span>
        </div>
        <div
          className="my-[14px] mb-compact grid grid-cols-2 gap-[9px] [@media(max-width:560px)]:grid-cols-1"
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
            <Button
              type="button"
              key={key}
              variant={start === key ? "light" : "default"}
              h="auto"
              p="sm"
              justify="flex-start"
              classNames={{
                label:
                  "flex-col items-start gap-[5px] whitespace-normal text-left",
              }}
              aria-pressed={start === key}
              onClick={() => setStart(key)}
            >
              <Text component="span" size="sm" c="inherit" fw="inherit">
                {name}
              </Text>
              <Text component="span" size="xs" lh="xs">
                {detail}
              </Text>
            </Button>
          ))}
        </div>
        <div className="p-[14px] bg-surface-subtle border border-border rounded-md">
          {start === "new" && (
            <div className="flex flex-wrap items-end gap-compact">
              <NativeSelect
                label="Starting preset"
                className="min-w-[170px] flex-1"
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
              </NativeSelect>
              <span className="text-caption/[inherit] text-[#738198]">
                Adjust any setting below before reviewing.
              </span>
            </div>
          )}
          {start === "saved" && (
            <div className="flex flex-wrap items-end gap-compact">
              <NativeSelect
                label="Saved configurations"
                className="min-w-[170px] flex-1"
                value={chosenProfile}
                onChange={(e) => setChosenProfile(e.target.value)}
              >
                <option value="">Choose a saved profile</option>
                {profiles.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name}
                  </option>
                ))}
              </NativeSelect>
              <Button
                size="xs"
                type="button"
                disabled={!chosenProfile}
                onClick={() => {
                  const p = profiles.find(
                    (item) => item.name === chosenProfile,
                  );
                  if (p) setDraft(toDraft(p.options));
                }}
              >
                Load profile
              </Button>
              {!profiles.length && (
                <span className="text-caption/[inherit] text-[#738198]">
                  No saved profiles yet. Save one in the summary panel.
                </span>
              )}
            </div>
          )}
          {start === "previous" && <PreviousRunPicker setDraft={setDraft} />}
          {start === "command" && (
            <div>
              <Textarea
                label="Paste an SPT command"
                className="my-xs"
                resize="vertical"
                styles={{
                  input: {
                    fontFamily: "var(--mantine-font-family-monospace)",
                    fontSize: "var(--mantine-font-size-caption)",
                    lineHeight: 1.6,
                    padding: "var(--mantine-spacing-compact)",
                  },
                }}
                id="expert-cli-input"
                value={commandText}
                rows={3}
                spellCheck={false}
                placeholder="spt run write-verify --object-count 1000 --object-size 1MiB --threads 4 --auto-terminate-seconds 600"
                onChange={(e) => setCommandText(e.target.value)}
              />
              <div className="flex flex-wrap items-end gap-compact">
                <Button size="xs" type="button" onClick={importCommand}>
                  Import supported settings
                </Button>
                <span className="text-caption/[inherit] text-[#738198]">
                  Import only; commands are never executed. Four flags
                  supported.
                </span>
              </div>
              {commandMessage && (
                <Text
                  c={importError ? "#b73a2b" : "#23754e"}
                  size="caption"
                  className="mt-[9px]"
                  role="status"
                >
                  {commandMessage}
                </Text>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-[5px] mt-[23px]">
          <strong className="text-base/[inherit] text-foreground">
            {workloadName} · Essential settings
          </strong>
          <span className="text-[#6b7b90] text-sm/[inherit]">
            The current dashboard API supports this workload and these four run
            settings.
          </span>
        </div>
        <ExpertFields
          draft={draft}
          setDraft={setDraft}
          errors={errors}
          limits={limits}
          showPresets={false}
        />
        <Accordion>
          <Accordion.Item value="section">
            <Accordion.Control>
              Host limits &amp; advanced settings
            </Accordion.Control>
            <Accordion.Panel>
              <Text size="caption" className="pt-sm">
                Other SPT CLI flags are not available through this version of
                the Dashboard API. Defaults are enforced by the Go server.
              </Text>
              <dl className="mx-0 mt-compact mb-0">
                <div className="px-0 py-xs flex justify-between gap-sm border-b border-b-[#e7edf5] text-caption/[inherit]">
                  <dt className="text-muted">Maximum objects</dt>
                  <dd className="m-0 font-heading text-right wrap-anywhere">
                    {limits.expert.object_count.max.toLocaleString("en-US")}
                  </dd>
                </div>
                <div className="px-0 py-xs flex justify-between gap-sm border-b border-b-[#e7edf5] text-caption/[inherit]">
                  <dt className="text-muted">Maximum threads / client</dt>
                  <dd className="m-0 font-heading text-right wrap-anywhere">
                    {limits.expert.threads.max}
                  </dd>
                </div>
                <div className="px-0 py-xs flex justify-between gap-sm border-b border-b-[#e7edf5] text-caption/[inherit]">
                  <dt className="text-muted">Maximum object size</dt>
                  <dd className="m-0 font-heading text-right wrap-anywhere">
                    {formatBytes(limits.expert.object_size_bytes.max)}
                  </dd>
                </div>
                <div className="px-0 py-xs flex justify-between gap-sm border-b border-b-[#e7edf5] text-caption/[inherit]">
                  <dt className="text-muted">Maximum runtime</dt>
                  <dd className="m-0 font-heading text-right wrap-anywhere">
                    {limits.expert.max_runtime_seconds.max}s
                  </dd>
                </div>
                <div className="px-0 py-xs flex justify-between gap-sm border-b border-b-[#e7edf5] text-caption/[inherit]">
                  <dt className="text-muted">Maximum data</dt>
                  <dd className="m-0 font-heading text-right wrap-anywhere">
                    {formatBytes(limits.expert.max_total_bytes)}
                  </dd>
                </div>
              </dl>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      </div>
      <aside
        className="p-lg border border-[#dbe5f0] rounded-lg bg-[#f7fafe] sticky top-[20px] min-w-0 [@media(max-width:1000px)]:static"
        aria-label="Expert configuration summary"
      >
        <span className="block text-xs/[inherit] tracking-[1.3px] text-[#6b7f99] font-heading mb-[9px]">
          CONFIGURATION SUMMARY
        </span>
        <Title order={3} size="lg" className="mb-[3px]">
          {workloadName}
        </Title>
        <span className="text-[#697c93] text-caption/[inherit]">
          {clients} client machine{clients === 1 ? "" : "s"} ·{" "}
          {driver === "mock"
            ? "No storage used"
            : verified
              ? "Storage verified"
              : "Storage not verified"}
        </span>
        <dl className="mx-0 mt-compact mb-0">
          <div className="px-0 py-xs flex justify-between gap-sm border-b border-b-[#e7edf5] text-caption/[inherit]">
            <dt className="text-muted">Maximum objects</dt>
            <dd className="m-0 font-heading text-right wrap-anywhere">
              {draft.object_count || "—"}
            </dd>
          </div>
          <div className="px-0 py-xs flex justify-between gap-sm border-b border-b-[#e7edf5] text-caption/[inherit]">
            <dt className="text-muted">Object size</dt>
            <dd className="m-0 font-heading text-right wrap-anywhere">
              {draft.size_amount
                ? `${draft.size_amount} ${draft.size_unit}`
                : "—"}
            </dd>
          </div>
          <div className="px-0 py-xs flex justify-between gap-sm border-b border-b-[#e7edf5] text-caption/[inherit]">
            <dt className="text-muted">Threads / client</dt>
            <dd className="m-0 font-heading text-right wrap-anywhere">
              {draft.threads || "—"}
            </dd>
          </div>
          <div className="px-0 py-xs flex justify-between gap-sm border-b border-b-[#e7edf5] text-caption/[inherit]">
            <dt className="text-muted">Safety limit</dt>
            <dd className="m-0 font-heading text-right wrap-anywhere">
              {draft.max_runtime_seconds
                ? `${draft.max_runtime_seconds}s`
                : "—"}
            </dd>
          </div>
        </dl>
        <div className="p-sm flex flex-col gap-[5px] mt-[14px] bg-[var(--mantine-color-spt-1)] rounded-control text-caption/[inherit]">
          <strong>Maximum test data</strong>
          <span className="text-emphasis/[inherit] font-bold text-[#176aca]">
            {Number.isFinite(volume) ? formatBytes(volume) : "—"}
          </span>
        </div>
        <div className="mx-0 my-md text-caption/[inherit]">
          <strong>Modified from defaults</strong>
          <div className="flex gap-[5px] flex-wrap mt-[9px]">
            {changed.length ? (
              changed.map(([, label]) => (
                <span
                  className="px-[7px] py-xxs rounded-chip bg-[#e4effe] text-[var(--mantine-color-spt-7)] text-xs/[inherit]"
                  key={label}
                >
                  {label}
                </span>
              ))
            ) : (
              <span className="px-[7px] py-xxs rounded-chip bg-[#e8edf3] text-muted text-xs/[inherit]">
                Using defaults
              </span>
            )}
          </div>
        </div>
        <Accordion mt="md">
          <Accordion.Item value="section">
            <Accordion.Control>Preview CLI settings</Accordion.Control>
            <Accordion.Panel>
              <Code
                block
                className="whitespace-pre-wrap wrap-anywhere"
                p="sm"
                fz="xs"
              >
                {valid
                  ? expertCommand(draft, driver)
                  : "Correct the settings to generate a command preview."}
              </Code>
              <small className="font-normal text-[#738198] text-xs/[inherit]">
                {driver === "mock"
                  ? "The Go backend adds the client machines, safe flags and the results directory. No storage credentials are passed."
                  : "The Go backend adds storage credentials, safe flags and the results directory."}
              </small>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
        <div className="grid gap-xs mt-comfortable pt-[15px] border-t border-t-border">
          <TextInput
            label="Save this configuration"
            id="expert-profile-name"
            value={profileName}
            placeholder="Profile name"
            maxLength={60}
            onChange={(e) => setProfileName(e.target.value)}
          />
          <Button
            size="xs"
            type="button"
            disabled={!valid}
            onClick={saveProfile}
          >
            Save profile
          </Button>
          {saveMessage && (
            <small
              className="font-normal text-muted text-xs/[inherit]"
              role="status"
            >
              {saveMessage}
            </small>
          )}
        </div>
      </aside>
    </div>
  );
}

export function Configure({
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
  // Each mode keeps its own values; a mode change returns to editing.
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
      className={`mx-auto my-[15px] ${mode === "expert" ? "max-w-[1210px]" : "max-w-[800px]"}`}
    >
      <span className="block text-xs/[inherit] tracking-[1.3px] text-[#6b7f99] font-heading mb-compact">
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
        className="mb-panel p-panel [@media(max-width:760px)]:p-[17px]"
      >
        <span className="block text-xs/[inherit] tracking-[1.3px] text-[#6b7f99] font-heading mb-compact">
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
        className="mb-panel p-panel [@media(max-width:760px)]:p-[17px]"
      >
        <span className="block text-xs/[inherit] tracking-[1.3px] text-[#6b7f99] font-heading mb-compact">
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
          <div className="my-comfortable grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-sm">
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
            <>
              <div className="p-lg bg-surface-review rounded-md mb-lg">
                <Title order={2}>
                  {driver === "mock" ? "Mock driver" : "Write + verify"} ·{" "}
                  {mode === "expert" ? "Expert" : "Guided"} · {clients} client
                  machine
                  {clients === 1 ? "" : "s"}
                </Title>
                <dl className="grid grid-cols-2 gap-lg [@media(max-width:760px)]:grid-cols-1">
                  <div>
                    <dt className="text-muted text-caption/[inherit] mb-[7px]">
                      Maximum objects
                    </dt>
                    <dd className="m-0 text-control/[inherit] font-semibold wrap-anywhere">
                      {config.object_count}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted text-caption/[inherit] mb-[7px]">
                      Object size
                    </dt>
                    <dd className="m-0 text-control/[inherit] font-semibold wrap-anywhere">
                      {config.object_size}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted text-caption/[inherit] mb-[7px]">
                      Parallel threads
                    </dt>
                    <dd className="m-0 text-control/[inherit] font-semibold wrap-anywhere">
                      {config.threads}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted text-caption/[inherit] mb-[7px]">
                      Safety time limit
                    </dt>
                    <dd className="m-0 text-control/[inherit] font-semibold wrap-anywhere">
                      {config.max_runtime_seconds}s
                    </dd>
                  </div>
                </dl>
                {driver === "mock" ? (
                  <Text size="sm" className="mt-xs">
                    Mock run: no data is written to S3. Results show SPT's mock
                    driver, not storage performance.
                  </Text>
                ) : (
                  <Text size="sm" className="mt-xs">
                    Up to {fmt(totalBytes / 1048576, 2)} MiB of test data. A
                    unique prefix isolates this run. Cleanup is best effort.
                  </Text>
                )}
                {mode === "expert" && (
                  <div className="mt-[14px]">
                    <strong className="text-sm/[inherit]">
                      CLI settings preview
                    </strong>
                    <Code
                      block
                      className="whitespace-pre-wrap wrap-anywhere"
                      p="sm"
                      fz="xs"
                    >
                      {expertCommand(draft, driver)}
                    </Code>
                    <small className="font-normal text-[#738198] text-xs/[inherit]">
                      The server generates the complete command and validates
                      all options.
                    </small>
                  </div>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-compact">
                <Button disabled={busy} onClick={() => setReview(false)}>
                  Edit settings
                </Button>
                <Button
                  variant="filled"
                  loading={busy}
                  disabled={busy || !ready}
                  onClick={() => void start()}
                >
                  {busy ? "Starting…" : "Start run"}
                </Button>
              </div>
              <Text size="sm" className="my-comfortable">
                {driver === "mock"
                  ? "Starting runs SPT with the mock driver on the verified client machines."
                  : "Starting runs a real benchmark on the configured storage target."}
              </Text>
            </>
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
    <NativeSelect
      label={label}
      value={config[key]}
      error={errors[key]}
      description={!errors[key] ? hint : undefined}
      onChange={(e) => setConfig({ ...config, [key]: Number(e.target.value) })}
      data={values.map((v) => ({ value: String(v), label: `${v}${suffix}` }))}
    />
  );
  return (
    <div className="my-xl grid grid-cols-2 gap-panel [@media(max-width:760px)]:grid-cols-1">
      {select(
        "object_count",
        "Maximum objects",
        g.object_counts,
        "Stop after this many objects.",
      )}
      <NativeSelect
        label="Object size"
        value={config.object_size}
        error={errors.object_size}
        description={
          !errors.object_size ? "Size of each test object." : undefined
        }
        onChange={(e) => setConfig({ ...config, object_size: e.target.value })}
        data={g.object_sizes}
      />
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
    <TextInput
      label={label}
      type="number"
      inputMode="numeric"
      min={range.min}
      max={range.max}
      step={1}
      value={draft[key]}
      error={errors[key]}
      description={!errors[key] ? hint : undefined}
      onChange={(ev) => setDraft({ ...draft, [key]: ev.target.value })}
    />
  );
  return (
    <>
      {showPresets && (
        <div
          className="mt-[6px] flex flex-wrap gap-compact"
          role="group"
          aria-label="Starting points"
        >
          {expertPresets.map((p) => (
            <Button
              type="button"
              key={p.label}
              h="auto"
              py="sm"
              classNames={{
                label:
                  "flex-col items-start gap-[3px] whitespace-normal text-left",
              }}
              onClick={() => setDraft(toDraft(p.options))}
            >
              {p.label}
              <Text component="span" size="caption" c="var(--spt-text-muted)">
                {p.options.object_count.toLocaleString("en-US")} ×{" "}
                {p.options.object_size} · {p.options.threads} threads
              </Text>
            </Button>
          ))}
        </div>
      )}
      <div className="mt-[15px] mb-lg grid grid-cols-2 gap-[15px] [@media(max-width:760px)]:grid-cols-1">
        {number(
          "object_count",
          "Maximum objects",
          e.object_count,
          `${e.object_count.min}–${e.object_count.max.toLocaleString("en-US")} objects.`,
        )}
        <Input.Wrapper
          id="expert-object-size-amount"
          label="Object size"
          error={errors.object_size}
          description={
            !errors.object_size
              ? `${formatBytes(e.object_size_bytes.min)}–${formatBytes(e.object_size_bytes.max)} per object.`
              : undefined
          }
        >
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-xs">
            <Input
              id="expert-object-size-amount"
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={draft.size_amount}
              aria-label="Object size amount"
              error={!!errors.object_size}
              onChange={(ev) =>
                setDraft({ ...draft, size_amount: ev.target.value })
              }
            />
            <NativeSelect
              aria-label="Object size unit"
              value={draft.size_unit}
              onChange={(ev) =>
                setDraft({ ...draft, size_unit: ev.target.value as SizeUnit })
              }
              data={Object.keys(sizeUnits)}
            />
          </div>
        </Input.Wrapper>
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
