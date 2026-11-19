import type { DataStatus, Row } from "../types";
export function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
export function formatNumber(value: unknown, digits = 0): string {
  const n = numeric(value);
  return n === null
    ? "—"
    : new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(
        n,
      );
}
/** AC1: missing/delayed telemetry must not look like a measured zero. */
export function formatMetric(
  value: unknown,
  digits = 0,
  status?: DataStatus,
): string {
  if (status === "no_data") return "No data";
  if (status === "delayed" && numeric(value) === null) return "Delayed";
  if (status === "delayed" && numeric(value) !== null) {
    return `${formatNumber(value, digits)} (delayed)`;
  }
  return formatNumber(value, digits);
}
export function formatChartValue(value: unknown): string {
  const n = numeric(value);
  if (n === null) return "—";
  if (n !== 0 && Math.abs(n) < 0.001) return n.toExponential(2);
  return Math.abs(n) < 1
    ? new Intl.NumberFormat("en-US", { maximumSignificantDigits: 3 }).format(n)
    : formatNumber(n, 2);
}
export function formatChartAxisValue(value: number): string {
  return value !== 0 && Math.abs(value) < 0.001
    ? value.toExponential(1)
    : new Intl.NumberFormat("en-US", {
        notation: "compact",
        maximumSignificantDigits: 3,
      }).format(value);
}
export function elapsed(value: unknown): string {
  const n = numeric(value);
  if (n === null) return "—";
  if (n < 60) return `${formatNumber(n, 1)}s`;
  const s = Math.floor(n),
    d = Math.floor(s / 86400),
    h = Math.floor(s / 3600) % 24,
    m = Math.floor(s / 60) % 60;
  return [
    d ? `${d}d` : "",
    h ? `${h}h` : "",
    m ? `${m}m` : "",
    !d && !h ? `${s % 60}s` : "",
  ]
    .filter(Boolean)
    .join(" ");
}
export function phaseCode(name?: string) {
  const s = (name ?? "").toUpperCase();
  if (s === "SEED" || s === "CLEANUP") return s;
  return /CREATE|WRITE/.test(s)
    ? "CREATE"
    : /VERIFY|READ/.test(s)
      ? "VERIFY"
      : /DELETE|CLEANUP/.test(s)
        ? "DELETE"
        : "SPT";
}
export function phaseName(name?: string, workload?: string) {
  return {
    SEED: "Create test objects",
    CLEANUP: "Cleanup",
    CREATE: "Write",
    VERIFY: "Verify",
    DELETE: workload === "delete" ? "Delete" : "Cleanup",
    SPT: "SPT",
  }[phaseCode(name)];
}
export function utc(value?: string) {
  const t = Date.parse(value ?? "");
  return Number.isFinite(t)
    ? new Date(t).toISOString().replace("T", " ").replace("Z", " UTC")
    : "—";
}

export function rowPhase(row: Row, workload?: string): string {
  if (workload !== "delete") return phaseCode(row.phase ?? row.op_type);
  const step = (row.step_id ?? row.source_file ?? "").toLowerCase();
  if (step.includes("cleanup")) return "CLEANUP";
  if (step.includes("seed") || row.op_type === "CREATE") return "SEED";
  return phaseCode(row.phase ?? row.op_type);
}
