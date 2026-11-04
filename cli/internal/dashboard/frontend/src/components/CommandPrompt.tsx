import { useEffect, useRef } from "react";
import { defaults } from "../config";
import { CommandError, parseSptCommand } from "../flags/command";
import { findFlag, type FlagValue, type Workload } from "../flags/schema";
import type { Options, RunLimits } from "../types";
import { validateOptions } from "../utils/validation";

export type CommandReview =
  | {
      kind: "apply";
      workload: Workload;
      options: Options;
      advanced: Record<string, FlagValue>;
      // The flags the command sets, as "--name value" for the prompt.
      settings: string[];
    }
  | { kind: "reject"; problems: string[] };

// Text that looks like an spt run command, e.g. "spt run mock …" or
// "./spt run write-verify …". Only such pastes open the prompt.
export function looksLikeSptCommand(text: string): boolean {
  return /^\s*(\S*[\\/])?spt(\.exe)?\s+run(\s|$)/.test(text);
}

const workloadName = (w: Workload) =>
  w === "mock" ? "Mock driver" : "Write + verify";

// Reads a command into the full expert state it describes: settings the
// command leaves out return to their defaults, so the GUI matches it exactly.
export function reviewCommand(text: string, limits: RunLimits): CommandReview {
  try {
    const parsed = parseSptCommand(text);
    const options: Options = { ...defaults, ...parsed.core, mode: "expert" };
    const limitProblems = Object.values(validateOptions(options, limits));
    if (limitProblems.length)
      return { kind: "reject", problems: limitProblems };
    const settings = parsed.flags.map((name) => {
      const f = findFlag(parsed.workload, name);
      const core = f?.core;
      const value = core ? options[core] : parsed.advanced[name];
      return typeof value === "boolean"
        ? `--${name}${value ? "" : "=false"}`
        : `--${name} ${value}`;
    });
    return {
      kind: "apply",
      workload: parsed.workload,
      options,
      advanced: parsed.advanced,
      settings,
    };
  } catch (e) {
    return {
      kind: "reject",
      problems:
        e instanceof CommandError
          ? e.problems
          : ["The command could not be read."],
    };
  }
}

// A small modal asking whether to apply a pasted or imported command.
export function CommandPrompt({
  review,
  currentWorkload,
  onApply,
  onClose,
}: {
  review: CommandReview;
  currentWorkload: Workload;
  onApply: () => void;
  onClose: () => void;
}) {
  const primary = useRef<HTMLButtonElement>(null);
  useEffect(() => primary.current?.focus(), []);
  const apply = review.kind === "apply";
  return (
    <div
      className="command-prompt-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="command-prompt"
        role="dialog"
        aria-modal="true"
        aria-labelledby="command-prompt-title"
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
      >
        {apply ? (
          <>
            <h3 id="command-prompt-title">Apply this command?</h3>
            <p>
              Workload: <strong>{workloadName(review.workload)}</strong>
              {review.workload !== currentWorkload &&
                ` (switches from ${workloadName(currentWorkload)})`}
            </p>
            {review.settings.length ? (
              <>
                <p>
                  Sets {review.settings.length} flag
                  {review.settings.length === 1 ? "" : "s"}:
                </p>
                <ul className="command-prompt-flags">
                  {review.settings.map((s) => (
                    <li key={s}>
                      <code>{s}</code>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p>The command sets no flags.</p>
            )}
            <p className="command-prompt-note">
              Every setting not in the command returns to its default.
            </p>
            <div className="command-prompt-actions">
              <button type="button" onClick={onClose}>
                Cancel
              </button>
              <button
                ref={primary}
                type="button"
                className="primary"
                onClick={onApply}
              >
                Apply
              </button>
            </div>
          </>
        ) : (
          <>
            <h3 id="command-prompt-title">This command can't be applied</h3>
            <ul className="command-prompt-problems">
              {review.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
            <p className="command-prompt-note">Nothing was changed.</p>
            <div className="command-prompt-actions">
              <button
                ref={primary}
                type="button"
                className="primary"
                onClick={onClose}
              >
                OK
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
