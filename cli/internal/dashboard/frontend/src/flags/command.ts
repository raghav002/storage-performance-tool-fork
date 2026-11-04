// Reads and writes `spt run` commands for expert mode. Pasted text is only
// parsed in memory: it is never executed, stored or sent to the server.
import type { Options } from "../types";
import {
  advancedDefaults,
  allRunFlags,
  blockedFlags,
  findFlag,
  flagsFor,
  shortAliases,
  type CoreField,
  type FlagValue,
  type Workload,
} from "./schema";
import { validateAdvanced, validateFlagValue } from "./validate";

export type ParsedCommand = {
  workload: Workload;
  // Only the core settings the command sets; the caller fills in the rest.
  core: Partial<Pick<Options, CoreField>>;
  // Every preview-only flag of the workload, defaults included.
  advanced: Record<string, FlagValue>;
  // Flags the command sets explicitly, in command order.
  flags: string[];
};

// Thrown when any part of a command cannot be imported; the whole command is
// then rejected, and `problems` lists every reason.
export class CommandError extends Error {
  constructor(public readonly problems: string[]) {
    super(`This command can't be imported: ${problems.join(" ")}`);
    this.name = "CommandError";
  }
}

const workloads: readonly Workload[] = ["write-verify", "mock"];
const otherWorkloads = [
  "write",
  "read",
  "read-verify",
  "mixed",
  "delete",
  "list",
  "tables",
];
// Boolean spt run flags outside the GUI schema. A boolean takes no separate
// value, so the next word is not consumed when one of them is rejected.
const boolRunFlags = new Set([
  "slice-endpoints",
  "object-data-dedupable",
  "delete-existing",
  "allow-empty-prefix",
  "validate-inventory",
  "verify",
  "cleanup",
  "defer-verification",
  "create-prefix",
  "generate-only",
  "keep-scenario",
  "save-items",
  "allow-empty-selection",
  "shuffle",
  "force",
  "skip-image-pull",
  "auto-results",
  "auto-results-debug",
  "shutdown-on-complete",
  "attach-existing",
  "use-rdma",
  "rdma-fallback",
  "rdma-allow-missing-bytes-header",
  "rdma-buffer-pool",
  "no-provision",
  "minimal",
  "headless",
  "trace-append",
  "verbose",
]);
const trueWords = new Set(["true", "1", "t", "TRUE", "True"]);
const falseWords = new Set(["false", "0", "f", "FALSE", "False"]);

// Splits a shell-style command into words: quotes group words, and a
// backslash at the end of a line continues the command.
export function tokenize(text: string): string[] {
  const words: string[] = [];
  let word = "";
  let started = false;
  let quote: '"' | "'" | null = null;
  const source = text.replace(/\\\r?\n/g, " ");
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === "\\" && quote === '"' && i + 1 < source.length)
        word += source[++i];
      else word += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      started = true;
    } else if (/\s/.test(c)) {
      if (started) words.push(word);
      word = "";
      started = false;
    } else {
      if (c === "\\" && i + 1 < source.length) word += source[++i];
      else word += c;
      started = true;
    }
  }
  if (quote) throw new CommandError(["A quote is not closed."]);
  if (started) words.push(word);
  return words;
}

const isFlagWord = (w: string | undefined) =>
  w !== undefined && w.startsWith("-") && !/^-[0-9]/.test(w);

export function parseSptCommand(text: string): ParsedCommand {
  const words = tokenize(text.trim());
  if (
    words.length < 2 ||
    !/(^|[\\/])spt(\.exe)?$/.test(words[0]) ||
    words[1] !== "run"
  )
    throw new CommandError([
      "Start with spt run write-verify or spt run mock.",
    ]);
  const name = words[2];
  if (!workloads.includes(name as Workload))
    throw new CommandError([
      otherWorkloads.includes(name)
        ? `The dashboard runs write-verify and mock only, not ${name}.`
        : "Name the workload: spt run write-verify or spt run mock.",
    ]);
  const workload = name as Workload;
  const problems: string[] = [];
  const core: ParsedCommand["core"] = {};
  const advanced = advancedDefaults(workload);
  const flags: string[] = [];

  for (let i = 3; i < words.length; i++) {
    const word = words[i];
    if (!isFlagWord(word)) {
      problems.push(`Unexpected argument "${word}".`);
      continue;
    }
    const long = word.startsWith("--");
    const [raw, inline] = word.slice(long ? 2 : 1).split(/=(.*)/s, 2);
    const flag = long ? raw : shortAliases[raw];
    if (!flag) {
      problems.push(`${word.split("=")[0]}: unknown option.`);
      continue;
    }
    const label = `--${flag}`;
    const def = findFlag(workload, flag);
    if (!def) {
      // Consume the rejected flag's value so it is not reported again.
      if (
        inline === undefined &&
        !boolRunFlags.has(flag) &&
        !isFlagWord(words[i + 1])
      )
        i++;
      problems.push(
        blockedFlags[flag]
          ? `${label}: ${blockedFlags[flag]}`
          : allRunFlags.has(flag)
            ? `${label}: not available for ${workload} in the dashboard.`
            : `${label}: not an spt run option.`,
      );
      continue;
    }
    if (flags.includes(flag)) {
      problems.push(`${label} is set more than once.`);
      if (
        inline === undefined &&
        def.kind !== "bool" &&
        !isFlagWord(words[i + 1])
      )
        i++;
      continue;
    }
    flags.push(flag);

    let value: FlagValue;
    if (def.kind === "bool") {
      if (inline === undefined) value = true;
      else if (trueWords.has(inline)) value = true;
      else if (falseWords.has(inline)) value = false;
      else {
        problems.push(`${label} must be true or false.`);
        continue;
      }
    } else {
      const next =
        inline ?? (isFlagWord(words[i + 1]) ? undefined : words[++i]);
      if (next === undefined || next === "") {
        problems.push(`${label} needs a value.`);
        continue;
      }
      value = next;
    }

    if (def.core) {
      const v = String(value);
      if (def.core === "object_size") core.object_size = v;
      else if (/^[0-9]{1,9}$/.test(v)) core[def.core] = Number(v);
      else problems.push(`${label} must be a whole number.`);
      continue;
    }
    const message = validateFlagValue(def, value);
    if (message) problems.push(`${label}: ${message}`);
    else advanced[flag] = value;
  }

  if (!problems.length)
    for (const [flag, message] of Object.entries(
      validateAdvanced(workload, advanced, core.object_size ?? ""),
    ))
      problems.push(`--${flag}: ${message}`);
  if (problems.length) throw new CommandError(problems);
  return { workload, core, advanced, flags };
}

const quoted = (v: string) =>
  /^[A-Za-z0-9._:/@%+=,-]+$/.test(v) ? v : `'${v.replace(/'/g, "'\\''")}'`;

// The equivalent spt run command: the four core settings, then every
// preview-only flag that differs from the dashboard's default.
export function buildSptCommand(
  workload: Workload,
  core: Pick<Options, CoreField>,
  advanced: Record<string, FlagValue>,
): string {
  const parts = ["spt", "run", workload];
  for (const f of flagsFor(workload)) {
    const value = f.core
      ? String(core[f.core])
      : (advanced[f.name] ?? f.default);
    if (!f.core && value === f.default) continue;
    if (typeof value === "boolean")
      parts.push(value ? `--${f.name}` : `--${f.name}=false`);
    else if (value.trim() !== "")
      parts.push(`--${f.name}`, quoted(value.trim()));
  }
  return parts.join(" ");
}
