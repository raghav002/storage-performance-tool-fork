// Expert-mode flag schema for the workloads the dashboard runs today. The
// flags themselves come from the JSON files the dashboard server also reads
// (server/expertflags/, see its README): flags.json defines each flag once, and
// each <workload>.json lists that workload's sections, with the few fields
// that differ for it. This module checks those files and builds flagGroups.
import type { Driver, Options } from "../types";

export type Workload = "write-verify" | "write" | "mock";

export const workloads: readonly Workload[] = ["write-verify", "write", "mock"];
export const isWorkload = (w: unknown): w is Workload =>
  workloads.includes(w as Workload);
export const workloadName = (w: Workload) =>
  w === "mock" ? "Mock driver" : w === "write" ? "Write" : "Write + verify";
// The storage driver a workload runs on: only mock uses SPT's mock driver.
export const driverForWorkload = (w: Workload): Driver =>
  w === "mock" ? "mock" : "s3";
// The workload a run request (or a saved run's options) starts, read the same
// way the server reads it: the mock driver wins, then "workload", then the
// write-verify default.
export const workloadOfRequest = (
  o: Pick<Options, "driver" | "workload"> | undefined,
): Workload =>
  o?.driver === "mock"
    ? "mock"
    : o?.workload === "write"
      ? "write"
      : "write-verify";

// The run request fields that pick a workload: write-verify is the default, so
// it sends neither; mock is chosen by its driver.
export const workloadRequest = (
  w: Workload,
): Pick<Options, "driver" | "workload"> =>
  w === "mock"
    ? { driver: "mock" }
    : w === "write"
      ? { workload: "write" }
      : {};

export type FlagKind =
  | "int"
  | "float"
  | "bool"
  | "size"
  | "duration"
  | "enum"
  | "region"
  | "hostname"
  | "string";
export type FlagValue = string | boolean;
export type CoreField = Exclude<
  keyof Options,
  "mode" | "driver" | "workload" | "flags"
>;

export type FlagDef = {
  name: string; // without the leading "--"
  short?: string; // without the leading "-"
  kind: FlagKind;
  label: string;
  help: string;
  // The value the dashboard's own runs use; "" means SPT's default (flag omitted).
  default: FlagValue;
  min?: number;
  max?: number;
  options?: readonly string[];
  // Core flags are applied to runs and map onto the run request's Options.
  core?: CoreField;
};

export type GroupDef = {
  id: string;
  title: string;
  purpose: string;
  flags: readonly FlagDef[];
};

// The shared flag files, bundled into the page at build time.
const flagFiles = import.meta.glob("../../../server/expertflags/*.json", {
  import: "default",
  eager: true,
}) as Record<string, unknown>;

const flagKinds: readonly FlagKind[] = [
  "int",
  "float",
  "bool",
  "size",
  "duration",
  "enum",
  "region",
  "hostname",
  "string",
];
const coreFields: readonly CoreField[] = [
  "object_count",
  "object_size",
  "threads",
  "max_runtime_seconds",
];

type Json = Record<string, unknown>;
const isRecord = (v: unknown): v is Json =>
  !!v && typeof v === "object" && !Array.isArray(v);

function flagFile(name: string): unknown {
  const entry = Object.entries(flagFiles).find(([path]) =>
    path.endsWith(`/${name}`),
  );
  if (!entry) throw new Error(`Expert flag file ${name} is missing.`);
  return entry[1];
}

// One flag as the files describe it, checked and typed. alwaysPass is the
// server's business (whether runs pass the default when unset), so it is dropped.
function toFlagDef(name: string, raw: Json, where: string): FlagDef {
  const fail = (why: string): never => {
    throw new Error(`${where}: --${name} ${why}`);
  };
  const { kind, short, core, label, help, min, max, options } = raw;
  const value = raw.default;
  if (!flagKinds.includes(kind as FlagKind))
    fail(`has unknown kind ${String(kind)}`);
  if (typeof label !== "string" || typeof help !== "string")
    fail("needs a label and help text");
  if (typeof value !== "string" && typeof value !== "boolean")
    fail("needs a text or true/false default");
  const f: FlagDef = {
    name,
    kind: kind as FlagKind,
    label: label as string,
    help: help as string,
    default: value as FlagValue,
  };
  if (short !== undefined)
    f.short = typeof short === "string" ? short : fail("has a bad short form");
  if (core !== undefined)
    f.core = coreFields.includes(core as CoreField)
      ? (core as CoreField)
      : fail("names an unknown core field");
  if (min !== undefined)
    f.min = typeof min === "number" ? min : fail("has a non-numeric min");
  if (max !== undefined)
    f.max = typeof max === "number" ? max : fail("has a non-numeric max");
  if (options !== undefined)
    f.options =
      Array.isArray(options) && options.every((o) => typeof o === "string")
        ? options
        : fail("needs a list of text options");
  return f;
}

// A workload's sections: each entry's catalog definition, with the workload's
// own fields (an entry like {"name": "cleanup", "default": false}) laid over it.
function loadGroups(workload: Workload): GroupDef[] {
  const where = `${workload}.json`;
  const catalog = flagFile("flags.json");
  const file = flagFile(where);
  if (!isRecord(catalog) || !isRecord(file) || file.workload !== workload)
    throw new Error(`${where} does not describe the ${workload} workload.`);
  if (!Array.isArray(file.groups)) throw new Error(`${where} has no groups.`);
  return file.groups.map((g: unknown) => {
    if (!isRecord(g) || !Array.isArray(g.flags))
      throw new Error(`${where} has a malformed group.`);
    return {
      id: String(g.id),
      title: String(g.title),
      purpose: String(g.purpose),
      flags: g.flags.map((entry: unknown) => {
        const { name, ...override } =
          typeof entry === "string" ? { name: entry } : (entry as Json);
        const base = catalog[String(name)];
        if (!isRecord(base))
          throw new Error(`${where}: --${String(name)} is not in flags.json.`);
        const { alwaysPass, ...merged } = { ...base, ...override };
        void alwaysPass;
        return toFlagDef(String(name), merged, where);
      }),
    };
  });
}

export const flagGroups: Record<Workload, readonly GroupDef[]> = {
  "write-verify": loadGroups("write-verify"),
  write: loadGroups("write"),
  mock: loadGroups("mock"),
};

export function flagsFor(workload: Workload): FlagDef[] {
  return flagGroups[workload].flatMap((g) => g.flags);
}

export function findFlag(
  workload: Workload,
  name: string,
): FlagDef | undefined {
  return flagsFor(workload).find((f) => f.name === name);
}

// Default values of the preview-only flags; core flags live in the run Options.
export function advancedDefaults(
  workload: Workload,
): Record<string, FlagValue> {
  return Object.fromEntries(
    flagsFor(workload)
      .filter((f) => !f.core)
      .map((f) => [f.name, f.default]),
  );
}

// Workloads whose expert flags the dashboard server applies to runs
// (server/expertflags/). Other workloads' flags are preview-only: shown in
// the CLI preview and saved in profiles, never sent with a run.
export const appliedWorkloads: ReadonlySet<Workload> = new Set<Workload>([
  "write-verify",
  "write",
  "mock",
]);

// The flags a run request carries: only those that differ from the
// dashboard default, so an unchanged flag keeps the server's own default.
export function runFlags(
  workload: Workload,
  values: Record<string, FlagValue>,
): Record<string, FlagValue> {
  return Object.fromEntries(
    changedFlags(workload, values).map((f) => [f.name, values[f.name]]),
  );
}

// The preview-only flags whose value differs from the dashboard default.
export function changedFlags(
  workload: Workload,
  values: Record<string, FlagValue>,
): FlagDef[] {
  return flagsFor(workload).filter(
    (f) => !f.core && (values[f.name] ?? f.default) !== f.default,
  );
}

// Short options that spt run accepts, mapped to their long names.
export const shortAliases: Record<string, string> = {
  e: "endpoints",
  a: "access-key",
  s: "secret-key",
  b: "bucket",
  t: "threads",
  o: "object-size",
  n: "object-count",
  d: "duration",
  O: "output-dir",
};

const credentials =
  "Credentials come only from the VM's .env, never from the browser.";
const storage = "Set this in Storage configuration; verification checks it.";
const paths = "File locations on the VM are chosen by the dashboard server.";
const engine =
  "This changes what code runs, so the dashboard does not allow it.";
const infra = "Ports and infrastructure are managed by the dashboard server.";
const results = "The dashboard server collects results itself.";
const rdma = "RDMA needs host setup that the dashboard does not manage.";
const terminal = "Terminal display options do not apply to the dashboard.";
const debug = "Dry-run and debug switches are not available in the dashboard.";
const destructive =
  "DELETE workload options are not available in the dashboard.";
const buckets =
  "Dashboard runs use the one bucket from the VM's .env; bucket sets are not available.";
const nics =
  "NIC sets need multi-port client machines, which the dashboard does not manage yet.";

// Valid spt run flags that the GUI never sets, with the reason shown when a
// pasted command contains one.
export const blockedFlags: Record<string, string> = {
  "access-key": credentials,
  "secret-key": credentials,
  endpoints: storage,
  endpoint: storage,
  bucket: storage,
  "test-hosts": storage,
  prefix:
    "The dashboard writes each run under its own dashboard/<run-id>/ prefix.",
  "results-dir": paths,
  "output-dir": paths,
  label: paths,
  "items-file": paths,
  "read-items-file": paths,
  "delete-items-file": paths,
  "trace-file": paths,
  "trace-append": paths,
  "spt-image": engine,
  "skip-image-pull": engine,
  "engine-override": engine,
  "api-port": infra,
  "network-mode": infra,
  "rmi-port-start": infra,
  "rmi-port-count": infra,
  "rmi-registry-port": infra,
  force: infra,
  "attach-existing": infra,
  "dns-server": infra,
  "auto-results": results,
  "auto-results-debug": results,
  "shutdown-on-complete": results,
  "shutdown-linger": results,
  "bucket-metrics": results,
  "bucket-count": buckets,
  buckets: buckets,
  "buckets-file": buckets,
  "provision-target-bucket": buckets,
  interfaces: nics,
  "host-interfaces": nics,
  "use-rdma": rdma,
  "rdma-local-ip": rdma,
  "rdma-threshold": rdma,
  "rdma-fallback": rdma,
  "rdma-device": rdma,
  "rdma-log-level": rdma,
  "rdma-timeout-ms": rdma,
  "rdma-allow-missing-bytes-header": rdma,
  "rdma-buffer-pool": rdma,
  "rdma-copy-threads": rdma,
  headless: terminal,
  minimal: terminal,
  verbose: terminal,
  "generate-only": debug,
  "keep-scenario": debug,
  "create-prefix": "Deprecated in SPT: it has no effect and will be removed.",
  duration:
    "Dashboard runs are count-based; use Maximum objects and the safety limit.",
  "delete-batch-size": destructive,
  "delete-existing": destructive,
  "allow-empty-prefix": destructive,
  "max-failed-objects": destructive,
  "max-failure-percent": destructive,
  "failure-budget-grace": destructive,
  "validate-inventory": destructive,
  verify: destructive,
  "verification-timeout": destructive,
};

// Every flag spt run registers (cli/cmd/run.go init, bucket_set.go and
// endpoint_selection.go), used to tell "not for this workload" apart from a typo.
export const allRunFlags: ReadonlySet<string> = new Set([
  "endpoints",
  "endpoint",
  "slice-endpoints",
  "access-key",
  "secret-key",
  "bucket",
  "bucket-count",
  "buckets",
  "buckets-file",
  "provision-target-bucket",
  "bucket-metrics",
  "interfaces",
  "host-interfaces",
  "rmi-registry-port",
  "prefix",
  "region",
  "endpoint-selection",
  "endpoint-hostname",
  "dns-server",
  "dns-timeout",
  "endpoint-connect-timeout",
  "auth-version",
  "threads",
  "range-size",
  "range-offset",
  "range-align",
  "object-size",
  "object-data-compressibility",
  "object-data-dedupable",
  "object-count",
  "delete-batch-size",
  "delete-existing",
  "allow-empty-prefix",
  "max-failed-objects",
  "max-failure-percent",
  "failure-budget-grace",
  "validate-inventory",
  "verify",
  "verification-timeout",
  "duration",
  "prefix-shards",
  "part-size",
  "mpu-concurrent-objects",
  "mpu-concurrent-parts",
  "seed-objects",
  "cleanup",
  "defer-verification",
  "versions",
  "create-prefix",
  "output-dir",
  "generate-only",
  "auto-terminate-seconds",
  "keep-scenario",
  "save-items",
  "items-file",
  "allow-empty-selection",
  "integrity-max-console-failures",
  "integrity-runtime-identity-tier",
  "shuffle",
  "shuffle-batch-size",
  "read-phase-pause-seconds",
  "force",
  "get-distrib",
  "stat-distrib",
  "put-distrib",
  "delete-distrib",
  "read-items-file",
  "delete-items-file",
  "service-threads",
  "engine-override",
  "api-port",
  "skip-image-pull",
  "spt-image",
  "auto-results",
  "results-dir",
  "label",
  "auto-results-debug",
  "shutdown-on-complete",
  "shutdown-linger",
  "test-hosts",
  "min-hosts",
  "attach-existing",
  "network-mode",
  "rmi-port-start",
  "rmi-port-count",
  "s3-driver",
  "use-rdma",
  "rdma-local-ip",
  "rdma-threshold",
  "rdma-fallback",
  "rdma-device",
  "rdma-log-level",
  "rdma-timeout-ms",
  "rdma-allow-missing-bytes-header",
  "rdma-buffer-pool",
  "rdma-copy-threads",
  "checksum",
  "test-vector",
  "table-bucket",
  "namespace",
  "table-name",
  "concurrent-writers",
  "commit-freq-ms",
  "target-file-size",
  "ingest-file-size",
  "total-ingest",
  "namespace-count",
  "tables-per-ns",
  "read-concurrency",
  "compaction-timeout",
  "no-provision",
  "minimal",
  "headless",
  "trace-file",
  "trace-append",
  "verbose",
]);
