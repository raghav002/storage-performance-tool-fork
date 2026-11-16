import { describe, expect, it } from "vitest";
import {
  advancedDefaults,
  allRunFlags,
  blockedFlags,
  driverForWorkload,
  flagGroups,
  flagsFor,
  shortAliases,
  workloadRequest,
  type FlagDef,
  type Workload,
} from "./schema";

const workloads = Object.keys(flagGroups) as Workload[];

// The CLI's Go sources, read at test time so the flag lists cannot drift from spt run.
const goSources = import.meta.glob("../../../../../cmd/*.go", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

// Flag names spt run registers: runCmd.Flags().X(...) in run.go, plus the
// helpers run.go calls with runCmd.Flags() (bucket sets, endpoint selection).
function registeredRunFlags(): Set<string> {
  const files = Object.entries(goSources).filter(
    ([path]) => !path.endsWith("_test.go"),
  );
  const consts = new Map<string, string>();
  for (const [, src] of files)
    for (const m of src.matchAll(/^\s*(\w+)\s*=\s*"([^"]+)"/gm))
      consts.set(m[1], m[2]);
  const helpers = ["bucket_set.go", "endpoint_selection.go"];
  const names = new Set<string>();
  for (const [path, src] of files) {
    const receiver = helpers.some((h) => path.endsWith(`/${h}`))
      ? "flags"
      : "runCmd\\.Flags\\(\\)";
    const pattern = new RegExp(
      `${receiver}\\.(?:String|Bool|Int|Int64|Float64|Duration|StringSlice|StringArray)(?:P|Var|VarP)?\\(\\s*(?:&[\\w.]+,\\s*)?(?:"([^"]+)"|(\\w+))`,
      "g",
    );
    for (const m of src.matchAll(pattern)) {
      const name = m[1] ?? consts.get(m[2]);
      if (name) names.add(name);
    }
  }
  return names;
}

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

  it("lists exactly the flags spt run registers", () => {
    const registered = registeredRunFlags();
    expect(registered.size).toBeGreaterThan(100);
    expect([...registered].filter((n) => !allRunFlags.has(n))).toEqual([]);
    expect([...allRunFlags].filter((n) => !registered.has(n))).toEqual([]);
  });

  it("blocks deprecated and bucket-set flags with a reason", () => {
    for (const name of [
      "create-prefix",
      "bucket-count",
      "buckets",
      "interfaces",
      "host-interfaces",
    ])
      expect(blockedFlags[name], name).toBeTruthy();
  });

  it.each(workloads)("%s describes each flag in one or two sentences", (w) => {
    for (const f of flagsFor(w)) {
      const sentences = f.help.match(/[.!?](\s|$)/g) ?? [];
      expect(sentences.length, f.name).toBeGreaterThan(0);
      expect(sentences.length, f.name).toBeLessThanOrEqual(2);
      expect(f.help.length, f.name).toBeLessThanOrEqual(160);
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

  it("picks each workload's driver and request fields", () => {
    expect(driverForWorkload("write-verify")).toBe("s3");
    expect(driverForWorkload("write")).toBe("s3");
    expect(driverForWorkload("mock")).toBe("mock");
    // Write-verify is the server's default, so it sends neither field.
    expect(workloadRequest("write-verify")).toEqual({});
    expect(workloadRequest("write")).toEqual({ workload: "write" });
    expect(workloadRequest("mock")).toEqual({ driver: "mock" });
  });
});
