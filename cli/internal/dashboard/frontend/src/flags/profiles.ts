// Expert profiles saved in this browser's localStorage. A profile holds the
// workload, the four core settings and every preview-only flag; it never
// holds credentials, because the flag schema has no credential fields.
import type { Options } from "../types";
import {
  advancedDefaults,
  findFlag,
  type FlagValue,
  type Workload,
} from "./schema";
import { validateFlagValue } from "./validate";

export type ExpertProfile = {
  version: 2;
  name: string;
  workload: Workload;
  options: Options;
  advanced: Record<string, FlagValue>;
};

export const profileStorageKey = "spt-dashboard-expert-profiles-v2";
// Profiles saved before expert flags existed: core settings only, write-verify.
export const legacyProfileStorageKey = "spt-dashboard-expert-profiles-v1";
export const maxProfiles = 12;

type StorageLike = Pick<Storage, "getItem" | "setItem">;

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

function readCore(raw: unknown): Options | null {
  if (!isObject(raw)) return null;
  const { object_count, object_size, threads, max_runtime_seconds } = raw;
  if (
    typeof object_count !== "number" ||
    typeof object_size !== "string" ||
    typeof threads !== "number" ||
    typeof max_runtime_seconds !== "number"
  )
    return null;
  return {
    mode: "expert",
    object_count,
    object_size,
    threads,
    max_runtime_seconds,
  };
}

// Keeps only the workload's own preview-only flags with valid values; any
// other entry (unknown, blocked, core or damaged) falls back to its default.
export function cleanAdvanced(
  workload: Workload,
  raw: unknown,
): Record<string, FlagValue> {
  const values = advancedDefaults(workload);
  if (!isObject(raw)) return values;
  for (const [name, value] of Object.entries(raw)) {
    const f = findFlag(workload, name);
    if (
      f &&
      !f.core &&
      (typeof value === "string" || typeof value === "boolean") &&
      validateFlagValue(f, value) === null
    )
      values[name] = value;
  }
  return values;
}

function readList(storage: StorageLike, key: string): unknown[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(key) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function readProfiles(storage: StorageLike): ExpertProfile[] {
  let list: ExpertProfile[];
  try {
    list = readList(storage, profileStorageKey).flatMap((item) => {
      if (!isObject(item) || typeof item.name !== "string") return [];
      const workload = item.workload;
      const options = readCore(item.options);
      if (!options || (workload !== "mock" && workload !== "write-verify"))
        return [];
      return [
        {
          version: 2 as const,
          name: item.name.slice(0, 60),
          workload,
          options,
          advanced: cleanAdvanced(workload, item.advanced),
        },
      ];
    });
    if (!list.length && storage.getItem(profileStorageKey) === null)
      list = readList(storage, legacyProfileStorageKey).flatMap((item) => {
        const options = isObject(item) ? readCore(item.options) : null;
        if (!options || !isObject(item) || typeof item.name !== "string")
          return [];
        return [
          {
            version: 2 as const,
            name: item.name.slice(0, 60),
            workload: "write-verify" as const,
            options,
            advanced: advancedDefaults("write-verify"),
          },
        ];
      });
  } catch {
    return [];
  }
  return list.slice(0, maxProfiles);
}

// Saves a profile first in the list, replacing one with the same name.
// Returns the new list; throws if browser storage is unavailable.
export function saveProfile(
  storage: StorageLike,
  profiles: ExpertProfile[],
  profile: Omit<ExpertProfile, "version">,
): ExpertProfile[] {
  const options = readCore(profile.options);
  if (!options) throw new Error("The profile's run settings are incomplete.");
  const saved: ExpertProfile = {
    version: 2,
    name: profile.name.trim().slice(0, 60),
    workload: profile.workload,
    options,
    advanced: cleanAdvanced(profile.workload, profile.advanced),
  };
  const next = [saved, ...profiles.filter((p) => p.name !== saved.name)].slice(
    0,
    maxProfiles,
  );
  storage.setItem(profileStorageKey, JSON.stringify(next));
  return next;
}
