import { describe, expect, it } from "vitest";
import {
  advancedDefaults,
  allRunFlags,
  blockedFlags,
  driverForWorkload,
  flagGroups,
  flagsFor,
  shortAliases,
  workloadForDriver,
  type FlagDef,
  type Workload,
} from "./schema";

const workloads = Object.keys(flagGroups) as Workload[];

function defaultFits(f: FlagDef): boolean {
  const v = f.default;
  switch (f.kind) {
    case "bool":
      return typeof v === "boolean";
    case "int":
    case "float": {
      if (typeof v !== "string") return false;
      if (v === "") return true;
      const n = Number(v);
      if (!Number.isFinite(n) || (f.kind === "int" && !Number.isInteger(n)))
        return false;
      return (f.min ?? -Infinity) <= n && n <= (f.max ?? Infinity);
    }
    case "enum":
      return typeof v === "string" && (v === "" || !!f.options?.includes(v));
    default:
      return typeof v === "string";
  }
}

describe("expert flag schema", () => {
  it.each(workloads)("%s lists each flag once, in one group", (w) => {
    const names = flagsFor(w).map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
    const groupIds = flagGroups[w].map((g) => g.id);
    expect(new Set(groupIds).size).toBe(groupIds.length);
    for (const g of flagGroups[w]) expect(g.flags.length).toBeGreaterThan(0);
  });

  it.each(workloads)("%s maps the four core settings first", (w) => {
    const first = flagGroups[w][0];
    expect(first.id).toBe("run-size");
    expect(first.flags.map((f) => f.core)).toEqual([
      "object_count",
      "object_size",
      "threads",
      "max_runtime_seconds",
    ]);
    expect(flagsFor(w).filter((f) => f.core)).toHaveLength(4);
  });

  it.each(workloads)("%s defaults fit their own kind and range", (w) => {
    for (const f of flagsFor(w)) expect(defaultFits(f), f.name).toBe(true);
  });

  it.each(workloads)("%s offers only real, unblocked spt run flags", (w) => {
    for (const f of flagsFor(w)) {
      expect(allRunFlags.has(f.name), f.name).toBe(true);
      expect(blockedFlags[f.name], f.name).toBeUndefined();
      if (f.short) expect(shortAliases[f.short]).toBe(f.name);
    }
  });

  it("blocks only real flags and aliases real names", () => {
    for (const name of Object.keys(blockedFlags))
      expect(allRunFlags.has(name), name).toBe(true);
    for (const name of Object.values(shortAliases))
      expect(allRunFlags.has(name), name).toBe(true);
  });

  it("matches the dashboard's own run defaults", () => {
    expect(advancedDefaults("write-verify")).toMatchObject({
      cleanup: true,
      "object-data-compressibility": "0",
      "object-data-dedupable": true,
      "auth-version": "4",
      "s3-driver": "default",
    });
    expect(advancedDefaults("mock")).toEqual({
      cleanup: false,
      "min-hosts": "0",
      "service-threads": "",
    });
  });

  it("maps drivers and workloads both ways", () => {
    expect(workloadForDriver(undefined)).toBe("write-verify");
    expect(workloadForDriver("s3")).toBe("write-verify");
    expect(workloadForDriver("mock")).toBe("mock");
    for (const w of workloads)
      expect(workloadForDriver(driverForWorkload(w))).toBe(w);
  });
});
