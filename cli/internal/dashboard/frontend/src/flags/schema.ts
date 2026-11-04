// Expert-mode flag schema for the workloads the dashboard runs today.
// The dashboard server applies only the four core settings; every other flag
// here is preview-only: kept in the browser, saved in profiles and shown in
// the CLI preview, never sent with a run request.
import { defaults } from "../config";
import type { Driver, Options } from "../types";

export type Workload = "write-verify" | "mock";

export const workloadForDriver = (d: Driver | undefined): Workload =>
  d === "mock" ? "mock" : "write-verify";
export const driverForWorkload = (w: Workload): Driver =>
  w === "mock" ? "mock" : "s3";

export type FlagKind =
  "int" | "float" | "bool" | "size" | "duration" | "enum" | "string";
export type FlagValue = string | boolean;
export type CoreField = Exclude<keyof Options, "mode" | "driver">;

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
    },
    {
      name: "service-threads",
      kind: "int",
      label: "Engine service threads",
      help: "Engine virtual-thread carrier parallelism. Empty uses the dashboard default (the thread count).",
      default: "",
      min: 0,
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
        help: "Ask S3 to validate each upload with this algorithm.",
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
        help: "Empty uploads each object in one request. Must be smaller than the object size.",
        default: "",
      },
      {
        name: "mpu-concurrent-objects",
        kind: "int",
        label: "Concurrent multipart objects",
        help: "0 is unlimited. Requires a part size.",
        default: "0",
        min: 0,
      },
      {
        name: "mpu-concurrent-parts",
        kind: "int",
        label: "Concurrent parts per object",
        help: "0 is unlimited. Requires a part size.",
        default: "0",
        min: 0,
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
        help: "-1 derives the count from the concurrency, 0 keeps keys flat.",
        default: "-1",
        min: -1,
      },
      {
        name: "create-prefix",
        kind: "bool",
        label: "Create prefix first",
        help: "Create the target prefix before writing.",
        default: false,
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
        help: "S3 request signing version.",
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
        help: "Per-request DNS only. Empty uses 5s.",
        default: "",
      },
      {
        name: "endpoint-connect-timeout",
        kind: "duration",
        label: "Connect timeout",
        help: "Round-robin and per-request DNS only. Empty uses 30s.",
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
  force: infra,
  "attach-existing": infra,
  "dns-server": infra,
  "auto-results": results,
  "auto-results-debug": results,
  "shutdown-on-complete": results,
  "shutdown-linger": results,
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

// Every flag spt run registers (cli/cmd/run.go init and endpoint_selection.go),
// used to tell "not for this workload" apart from a typo.
export const allRunFlags: ReadonlySet<string> = new Set([
  "endpoints",
  "endpoint",
  "slice-endpoints",
  "access-key",
  "secret-key",
  "bucket",
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
