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
import { useEffect, useRef, useState } from "react";
import type { Options, State } from "../../types";
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
  toDraft,
  type ExpertDraft,
} from "./configuration";
import {
  readProfiles,
  saveProfile as writeProfile,
  type ExpertProfile,
} from "../../flags/profiles";
import {
  appliedWorkloads,
  changedFlags,
  workloadName,
  type FlagValue,
  type Workload,
} from "../../flags/schema";
import type { FlagErrors } from "../../flags/validate";
import {
  CommandPrompt,
  looksLikeSptCommand,
  reviewCommand,
  type CommandReview,
} from "./CommandPrompt";
import { ExpertFields } from "./ExpertFields";
import { ExpertFlagGroups } from "./ExpertFlagGroups";
import { PreviousRunPicker } from "./PreviousRunPicker";

type AdvancedValues = Record<string, FlagValue>;

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

export function ExpertWorkspace({
  draft,
  setDraft,
  errors,
  limits,
  verified,
  clients,
  workload,
  setWorkload,
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
  workload: Workload;
  setWorkload: (w: Workload) => void;
  advanced: AdvancedValues;
  setAdvanced: (workload: Workload, values: AdvancedValues) => void;
  advancedErrors: FlagErrors;
}) {
  const name = workloadName(workload);
  const advancedChanged = changedFlags(workload, advanced);
  const applied = appliedWorkloads.has(workload);
  const advancedValid = Object.keys(advancedErrors).length === 0;
  const [start, setStart] = useState<ExpertStart>("new");
  const [profiles, setProfiles] = useState(readExpertProfiles);
  const [chosenProfile, setChosenProfile] = useState("");
  const [profileName, setProfileName] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
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
          ? `Saved in this browser with ${advancedChanged.length} ${applied ? "" : "preview-only "}flag${advancedChanged.length === 1 ? "" : "s"}. Storage credentials are not saved.`
          : "Saved in this browser. Storage credentials are not saved.",
      );
    } catch {
      setSaveMessage(
        "Browser storage is unavailable. Could not save this profile.",
      );
    }
  }

  // A profile restores its workload, the four core settings and every flag.
  function loadProfile(p: ExpertProfile) {
    setWorkload(p.workload);
    setDraft(toDraft(p.options));
    setAdvanced(p.workload, p.advanced);
  }

  // Pasting an spt run command anywhere in expert mode asks whether to apply
  // it. Pastes into fields outside the workspace (e.g. storage settings) are
  // left alone; pastes into workspace fields do not land in the field, except
  // the CLI command box, where keeping the text is useful.
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
      // A second paste does not replace a prompt that is already open.
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
    setWorkload(next);
    setDraft(toDraft(core));
    setAdvanced(next, flags);
    const count = commandReview.settings.length;
    setAppliedNote(
      `Command applied: ${workloadName(next)}${count ? ` with ${count} flag${count === 1 ? "" : "s"}` : ""}. Settings not in the command were reset to their defaults.`,
    );
    setCommandReview(null);
  }

  return (
    <div
      ref={workspaceRef}
      className="grid grid-cols-[minmax(0,1fr)_17.1875rem] items-start gap-6.25 mt-panel max-[62.5rem]:grid-cols-1"
    >
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
              ["command", "CLI command", "Import an spt run command"],
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
                    {p.name} · {workloadName(p.workload)}
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
                  if (p) loadProfile(p);
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
          {start === "previous" && (
            <PreviousRunPicker
              onDuplicate={(run) => {
                setWorkload(run.workload);
                setDraft(run.draft);
                setAdvanced(run.workload, run.advanced);
              }}
            />
          )}
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
                <Button
                  size="xs"
                  type="button"
                  disabled={!commandText.trim()}
                  onClick={() =>
                    setCommandReview(reviewCommand(commandText, limits))
                  }
                >
                  Import command
                </Button>
                <span className="text-caption/[inherit] text-[#738198]">
                  Commands are only read, never executed. Write-verify and mock
                  are supported. Tip: paste a command anywhere in Expert mode.
                </span>
              </div>
            </div>
          )}
        </div>
        {appliedNote && (
          <Text c="#23754e" size="caption" className="mt-2.25" role="status">
            {appliedNote}
          </Text>
        )}

        <div className="flex flex-col gap-1.25 mt-5.75">
          <strong className="text-base/[inherit] text-foreground">
            {name} · SPT flags
          </strong>
          <span className="text-[#6b7b90] text-sm/[inherit]">
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
              />
              <Accordion>
                <Accordion.Item value="section">
                  <Accordion.Control>Host limits</Accordion.Control>
                  <Accordion.Panel>
                    <Text size="caption" className="pt-sm">
                      The dashboard server enforces these limits on every run.
                    </Text>
                    <HostLimits limits={limits} />
                  </Accordion.Panel>
                </Accordion.Item>
              </Accordion>
            </>
          }
        />
      </div>
      <aside
        className="p-lg border-[0.0625rem] border-[#dbe5f0] rounded-lg bg-[#f7fafe] sticky top-lg min-w-0 max-[62.5rem]:static"
        aria-label="Expert configuration summary"
      >
        <span className="block text-xs/[inherit] tracking-[0.08125rem] text-[#6b7f99] font-heading mb-2.25">
          CONFIGURATION SUMMARY
        </span>
        <Title order={3} size="lg" className="mb-0.75">
          {name}
        </Title>
        <span className="text-[#697c93] text-caption/[inherit]">
          {clients} client machine{clients === 1 ? "" : "s"} ·{" "}
          {workload === "mock"
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
            {changed.length || advancedChanged.length ? (
              <>
                {changed.map(([, label]) => (
                  <span
                    className="px-1.75 py-xxs rounded-chip bg-[#e4effe] text-(--mantine-color-spt-7) text-xs/[inherit]"
                    key={label}
                  >
                    {label}
                  </span>
                ))}
                {advancedChanged.map((f) => (
                  <span
                    className={
                      applied
                        ? "px-1.75 py-xxs rounded-chip bg-[#e4effe] text-(--mantine-color-spt-7) text-xs/[inherit]"
                        : "px-1.75 py-xxs rounded-chip border border-dashed border-[#9fb3cc] text-muted text-xs/[inherit]"
                    }
                    key={f.name}
                  >
                    {f.label}
                  </span>
                ))}
              </>
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
                {valid && advancedValid
                  ? expertCommand(draft, workload, advanced)
                  : "Correct the settings to generate a command preview."}
              </Code>
              <small className="font-normal text-[#738198] text-xs/[inherit]">
                {workload === "mock"
                  ? "The Go backend adds the client machines, safe flags and the results directory. No storage credentials are passed."
                  : "The Go backend adds storage credentials, safe flags and the results directory."}
                {!applied &&
                  advancedChanged.length > 0 &&
                  " Dashboard runs apply only the four core settings; copy this command to run the rest with the SPT CLI."}
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
      <CommandPrompt
        review={commandReview}
        currentWorkload={workload}
        onApply={applyCommand}
        onClose={() => setCommandReview(null)}
      />
    </div>
  );
}

// The server's expert limits, shown next to the four settings they bound.
function HostLimits({ limits }: { limits: NonNullable<State["limits"]> }) {
  return (
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
  );
}
