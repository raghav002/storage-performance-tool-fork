// Expert-mode flag schema for the workloads the dashboard runs today.
// The dashboard server applies only the four core settings; every other flag
// here is preview-only: kept in the browser, saved in profiles and shown in
// the CLI preview, never sent with a run request.
import { defaults } from "../config";
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
  "int" | "float" | "bool" | "size" | "duration" | "enum" | "string";
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

const runSize: GroupDef = {
  id: "run-size",
  title: "Run size & limits",
  purpose: "How much work the run does and how long it may take.",
  flags: [
    {
      name: "object-count",
      short: "n",
      kind: "int",
      label: "Maximum objects",
      help: "Stop after this many objects.",
      default: String(defaults.object_count),
      core: "object_count",
    },
    {
      name: "object-size",
      short: "o",
      kind: "size",
      label: "Object size",
      help: "Size of each object, in KiB, MiB or GiB.",
      default: defaults.object_size,
      core: "object_size",
    },
    {
      name: "threads",
      short: "t",
      kind: "int",
      label: "Threads / client",
      help: "Parallel client threads on each client machine.",
      default: String(defaults.threads),
      core: "threads",
    },
    {
      name: "auto-terminate-seconds",
      kind: "int",
      label: "Safety limit (seconds)",
      help: "Stop the run after this many seconds, even if objects remain.",
      default: String(defaults.max_runtime_seconds),
      core: "max_runtime_seconds",
    },
  ],
};

const distribution: GroupDef = {
  id: "distribution",
  title: "Distribution & engine",
  purpose: "How the client machines and the SPT engine share the load.",
  flags: [
    {
      name: "min-hosts",
      kind: "int",
      label: "Minimum client machines",
      help: "Start when at least this many machines connect. 0 requires all of them.",
      default: "0",
      min: 0,
      max: 8,
    },
    {
      name: "service-threads",
      kind: "int",
      label: "Engine service threads",
      help: "Carrier threads for the engine's virtual threads. Empty uses the dashboard default, the thread count.",
      default: "",
      min: 1,
      max: 1024,
    },
  ],
};

const writeVerifyGroups: readonly GroupDef[] = [
  runSize,
  {
    id: "object-data",
    title: "Object data",
    purpose:
      "What the written bytes look like to compression, dedup and checksums.",
    flags: [
      {
        name: "object-data-compressibility",
        kind: "float",
        label: "Compressibility (%)",
        help: "Share of each 4 KB chunk that is zero-filled. 0 is fully random.",
        default: "0",
        min: 0,
        max: 100,
      },
      {
        name: "object-data-dedupable",
        kind: "bool",
        label: "Allow deduplication",
        help: "Off stamps every 4 KB with a unique header so storage cannot dedupe it.",
        default: true,
      },
      {
        name: "checksum",
        kind: "enum",
        label: "S3 checksum",
        help: "Ask S3 to check each upload with this checksum algorithm. Off sends no checksum.",
        default: "",
        options: ["crc32", "crc32c", "sha1", "sha256", "crc64-nvme"],
      },
    ],
  },
  {
    id: "multipart",
    title: "Multipart upload",
    purpose:
      "Upload large objects in parts, with their own concurrency limits.",
    flags: [
      {
        name: "part-size",
        kind: "size",
        label: "Part size",
        help: "Upload each object in parts of this size. Empty sends each object in one request; must be smaller than the object size.",
        default: "",
      },
      {
        name: "mpu-concurrent-objects",
        kind: "int",
        label: "Concurrent multipart objects",
        help: "How many objects may upload in parts at the same time. 0 is unlimited; needs a part size.",
        default: "0",
        min: 0,
        max: 1024,
      },
      {
        name: "mpu-concurrent-parts",
        kind: "int",
        label: "Concurrent parts per object",
        help: "How many parts of one object upload at the same time. 0 is unlimited; needs a part size.",
        default: "0",
        min: 0,
        max: 1024,
      },
    ],
  },
  {
    id: "verification",
    title: "Verification & cleanup",
    purpose:
      "When objects are read back, how failures are reported and what is removed.",
    flags: [
      {
        name: "defer-verification",
        kind: "bool",
        label: "Defer verification",
        help: "Stop after writing and verify later with read-verify. Not allowed with cleanup.",
        default: false,
      },
      {
        name: "cleanup",
        kind: "bool",
        label: "Clean up verified objects",
        help: "Delete each successfully verified object after the run.",
        default: true,
      },
      {
        name: "integrity-max-console-failures",
        kind: "int",
        label: "Failure samples shown",
        help: "Corruption samples printed to the console. 0 hides them.",
        default: "20",
        min: 0,
        max: 10000,
      },
      {
        name: "integrity-runtime-identity-tier",
        kind: "enum",
        label: "Engine identity check",
        help: "Image proves one engine image across machines; payload also compares its files.",
        default: "image",
        options: ["image", "payload"],
      },
    ],
  },
  {
    id: "key-layout",
    title: "Key layout",
    purpose: "How object keys are spread across prefix directories.",
    flags: [
      {
        name: "prefix-shards",
        kind: "int",
        label: "Prefix shards",
        help: "How many prefix directories object keys are spread over. -1 picks a count from the concurrency; 0 keeps keys flat.",
        default: "-1",
        min: -1,
        max: 65536,
      },
    ],
  },
  {
    id: "protocol",
    title: "Protocol & driver",
    purpose: "Which S3 client SPT uses and how it signs requests.",
    flags: [
      {
        name: "s3-driver",
        kind: "enum",
        label: "S3 driver",
        help: "Default is SPT's Netty driver; aws uses the AWS SDK.",
        default: "default",
        options: ["default", "aws"],
      },
      {
        name: "auth-version",
        kind: "enum",
        label: "Signature version",
        help: "Which S3 signature version signs each request. Version 4 is the current standard.",
        default: "4",
        options: ["2", "4"],
      },
      {
        name: "region",
        kind: "string",
        label: "Region",
        help: "AWS region for requests. Empty keeps the engine's selection.",
        default: "",
      },
    ],
  },
  {
    id: "endpoint-routing",
    title: "Endpoint routing",
    purpose: "Which address each request connects to. Netty driver only.",
    flags: [
      {
        name: "endpoint-selection",
        kind: "enum",
        label: "Endpoint selection",
        help: "Round-robin rotates over the endpoint's IPv4 addresses; per-request DNS resolves its hostname each time.",
        default: "default",
        options: ["default", "round-robin", "per-request-dns"],
      },
      {
        name: "endpoint-hostname",
        kind: "string",
        label: "Logical hostname",
        help: "Round-robin only: hostname for the Host header, signing and TLS SNI.",
        default: "",
      },
      {
        name: "dns-timeout",
        kind: "duration",
        label: "DNS timeout",
        help: "How long one DNS lookup may take with per-request DNS. Empty uses 5s.",
        default: "",
      },
      {
        name: "endpoint-connect-timeout",
        kind: "duration",
        label: "Connect timeout",
        help: "How long a TCP connect may take with round-robin or per-request DNS. Empty uses 30s.",
        default: "",
      },
      {
        name: "slice-endpoints",
        kind: "bool",
        label: "Slice endpoints across machines",
        help: "Give each client machine its own share of the endpoints.",
        default: false,
      },
    ],
  },
  distribution,
  {
    id: "results",
    title: "Results",
    purpose: "Extra artifacts saved with the run's results.",
    flags: [
      {
        name: "save-items",
        kind: "bool",
        label: "Save item list",
        help: "Save items.csv with every created object. Can be large.",
        default: false,
      },
    ],
  },
];

// spt run write rejects the verification-only flags (defer-verification and the
// integrity flags), so write keeps only cleanup from that group.
const writeCleanup: GroupDef = {
  id: "cleanup",
  title: "Cleanup",
  purpose: "What is removed after the run.",
  flags: [
    {
      name: "cleanup",
      kind: "bool",
      label: "Clean up written objects",
      help: "Delete each written object after the run. Off leaves them under the run's own prefix.",
      default: true,
    },
  ],
};
const writeGroups: readonly GroupDef[] = writeVerifyGroups.map((g) =>
  g.id === "verification" ? writeCleanup : g,
);

const mockGroups: readonly GroupDef[] = [
  runSize,
  {
    id: "cleanup",
    title: "Cleanup",
    purpose: "Add a mock delete phase after the create phase.",
    flags: [
      {
        name: "cleanup",
        kind: "bool",
        label: "Add a delete phase",
        help: "Exercise the delete step of the pipeline after creating objects.",
        default: false,
      },
    ],
  },
  distribution,
];

export const flagGroups: Record<Workload, readonly GroupDef[]> = {
  "write-verify": writeVerifyGroups,
  write: writeGroups,
  mock: mockGroups,
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
// (server/expert_flags.go). Other workloads' flags are preview-only: shown in
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
