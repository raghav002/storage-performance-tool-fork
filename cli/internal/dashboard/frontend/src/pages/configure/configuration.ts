import type { Driver, Options, State } from "../../types";
import {
  parseWhole,
  splitSize,
  validateOptions,
  type SizeUnit,
} from "../../utils/validation";

export type ExpertDraft = {
  object_count: string;
  size_amount: string;
  size_unit: SizeUnit;
  threads: string;
  max_runtime_seconds: string;
};
export const expertPresets: { label: string; options: Options }[] = [
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
export function toDraft(o: Options): ExpertDraft {
  const { amount, unit } = splitSize(o.object_size);
  return {
    object_count: String(o.object_count),
    size_amount: amount,
    size_unit: unit,
    threads: String(o.threads),
    max_runtime_seconds: String(o.max_runtime_seconds),
  };
}
export function fromDraft(d: ExpertDraft): Options {
  return {
    mode: "expert",
    object_count: parseWhole(d.object_count) ?? NaN,
    object_size: `${d.size_amount.trim()}${d.size_unit}`,
    threads: parseWhole(d.threads) ?? NaN,
    max_runtime_seconds: parseWhole(d.max_runtime_seconds) ?? NaN,
  };
}

export function parseExpertCommand(
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

export function expertCommand(draft: ExpertDraft, driver: Driver): string {
  const opts = fromDraft(draft);
  const workload = driver === "mock" ? "mock" : "write-verify";
  return `spt run ${workload} --object-count ${opts.object_count} --object-size ${opts.object_size} --threads ${opts.threads} --auto-terminate-seconds ${opts.max_runtime_seconds}`;
}
