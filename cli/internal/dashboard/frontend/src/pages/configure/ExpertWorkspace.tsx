import {
  Accordion,
  Button,
  Code,
  NativeSelect,
  Text,
  TextInput,
  Textarea,
  Title,
} from "@mantine/core";
import { useState } from "react";
import type { Driver, Options, State } from "../../types";
import { defaults } from "../../config";
import {
  formatBytes,
  parseSize,
  type OptionErrors,
} from "../../utils/validation";
import {
  expertCommand,
  expertPresets,
  fromDraft,
  parseExpertCommand,
  toDraft,
  type ExpertDraft,
} from "./configuration";
import { ExpertFields } from "./ExpertFields";
import { PreviousRunPicker } from "./PreviousRunPicker";

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

export function ExpertWorkspace({
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
    <div className="grid grid-cols-[minmax(0,1fr)_17.1875rem] items-start gap-6.25 mt-panel max-[62.5rem]:grid-cols-1">
      <div className="min-w-0">
        <div className="flex flex-col gap-1.25">
          <strong className="text-base/[inherit] text-foreground">
            Start from
          </strong>
          <span className="text-[#6b7b90] text-sm/[inherit]">
            Reuse a known configuration or start with the defaults.
          </span>
        </div>
        <div
          className="my-3.5 mb-compact grid grid-cols-2 gap-2.25 max-[35rem]:grid-cols-1"
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
                  "flex-col items-start gap-1.25 whitespace-normal text-left",
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
        <div className="p-3.5 bg-surface-subtle border-[0.0625rem] border-border rounded-md">
          {start === "new" && (
            <div className="flex flex-wrap items-end gap-compact">
              <NativeSelect
                label="Starting preset"
                className="min-w-42.5 flex-1"
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
                className="min-w-42.5 flex-1"
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
                  className="mt-2.25"
                  role="status"
                >
                  {commandMessage}
                </Text>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1.25 mt-5.75">
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
                <div className="px-0 py-xs flex justify-between gap-sm border-b-[0.0625rem] border-b-[#e7edf5] text-caption/[inherit]">
                  <dt className="text-muted">Maximum objects</dt>
                  <dd className="m-0 font-heading text-right wrap-anywhere">
                    {limits.expert.object_count.max.toLocaleString("en-US")}
                  </dd>
                </div>
                <div className="px-0 py-xs flex justify-between gap-sm border-b-[0.0625rem] border-b-[#e7edf5] text-caption/[inherit]">
                  <dt className="text-muted">Maximum threads / client</dt>
                  <dd className="m-0 font-heading text-right wrap-anywhere">
                    {limits.expert.threads.max}
                  </dd>
                </div>
                <div className="px-0 py-xs flex justify-between gap-sm border-b-[0.0625rem] border-b-[#e7edf5] text-caption/[inherit]">
                  <dt className="text-muted">Maximum object size</dt>
                  <dd className="m-0 font-heading text-right wrap-anywhere">
                    {formatBytes(limits.expert.object_size_bytes.max)}
                  </dd>
                </div>
                <div className="px-0 py-xs flex justify-between gap-sm border-b-[0.0625rem] border-b-[#e7edf5] text-caption/[inherit]">
                  <dt className="text-muted">Maximum runtime</dt>
                  <dd className="m-0 font-heading text-right wrap-anywhere">
                    {limits.expert.max_runtime_seconds.max}s
                  </dd>
                </div>
                <div className="px-0 py-xs flex justify-between gap-sm border-b-[0.0625rem] border-b-[#e7edf5] text-caption/[inherit]">
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
        className="p-lg border-[0.0625rem] border-[#dbe5f0] rounded-lg bg-[#f7fafe] sticky top-lg min-w-0 max-[62.5rem]:static"
        aria-label="Expert configuration summary"
      >
        <span className="block text-xs/[inherit] tracking-[0.08125rem] text-[#6b7f99] font-heading mb-2.25">
          CONFIGURATION SUMMARY
        </span>
        <Title order={3} size="lg" className="mb-0.75">
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
          <div className="px-0 py-xs flex justify-between gap-sm border-b-[0.0625rem] border-b-[#e7edf5] text-caption/[inherit]">
            <dt className="text-muted">Maximum objects</dt>
            <dd className="m-0 font-heading text-right wrap-anywhere">
              {draft.object_count || "—"}
            </dd>
          </div>
          <div className="px-0 py-xs flex justify-between gap-sm border-b-[0.0625rem] border-b-[#e7edf5] text-caption/[inherit]">
            <dt className="text-muted">Object size</dt>
            <dd className="m-0 font-heading text-right wrap-anywhere">
              {draft.size_amount
                ? `${draft.size_amount} ${draft.size_unit}`
                : "—"}
            </dd>
          </div>
          <div className="px-0 py-xs flex justify-between gap-sm border-b-[0.0625rem] border-b-[#e7edf5] text-caption/[inherit]">
            <dt className="text-muted">Threads / client</dt>
            <dd className="m-0 font-heading text-right wrap-anywhere">
              {draft.threads || "—"}
            </dd>
          </div>
          <div className="px-0 py-xs flex justify-between gap-sm border-b-[0.0625rem] border-b-[#e7edf5] text-caption/[inherit]">
            <dt className="text-muted">Safety limit</dt>
            <dd className="m-0 font-heading text-right wrap-anywhere">
              {draft.max_runtime_seconds
                ? `${draft.max_runtime_seconds}s`
                : "—"}
            </dd>
          </div>
        </dl>
        <div className="p-sm flex flex-col gap-1.25 mt-3.5 bg-(--mantine-color-spt-1) rounded-control text-caption/[inherit]">
          <strong>Maximum test data</strong>
          <span className="text-emphasis/[inherit] font-bold text-[#176aca]">
            {Number.isFinite(volume) ? formatBytes(volume) : "—"}
          </span>
        </div>
        <div className="mx-0 my-md text-caption/[inherit]">
          <strong>Modified from defaults</strong>
          <div className="flex gap-1.25 flex-wrap mt-2.25">
            {changed.length ? (
              changed.map(([, label]) => (
                <span
                  className="px-1.75 py-xxs rounded-chip bg-[#e4effe] text-(--mantine-color-spt-7) text-xs/[inherit]"
                  key={label}
                >
                  {label}
                </span>
              ))
            ) : (
              <span className="px-1.75 py-xxs rounded-chip bg-[#e8edf3] text-muted text-xs/[inherit]">
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
        <div className="grid gap-xs mt-comfortable pt-3.75 border-t-[0.0625rem] border-t-border">
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
