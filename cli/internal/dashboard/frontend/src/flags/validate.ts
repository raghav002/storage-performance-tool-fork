// Client-side checks for the preview-only expert flags, mirroring the rules
// spt run enforces (cli/cmd/validation.go). The four core settings keep their
// own checks in utils/validation.ts, which also match the dashboard server.
import { parseSize } from "../utils/validation";
import {
  flagsFor,
  type FlagDef,
  type FlagValue,
  type Workload,
} from "./schema";

export type FlagErrors = Record<string, string>;

const cliSizeUnits: Record<string, number> = {
  KiB: 2 ** 10,
  MiB: 2 ** 20,
  GiB: 2 ** 30,
  // spt run keeps the legacy units as 1024-based aliases.
  KB: 2 ** 10,
  MB: 2 ** 20,
  GB: 2 ** 30,
};
const cliSizePattern = /^([1-9][0-9]{0,8})(KiB|MiB|GiB|KB|MB|GB)$/;
const durationPattern = /^([0-9]+(\.[0-9]+)?(ns|us|µs|ms|s|m|h))+$/;
const hostnamePattern =
  /^(?=.{1,253}$)[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.?$/;
const regionPattern = /^[a-z0-9-]{1,64}$/;

// Size in bytes for a value spt run accepts, e.g. "64MiB" or legacy "5MB".
export function parseCliSize(value: string): number | null {
  const m = cliSizePattern.exec(value);
  return m ? Number(m[1]) * cliSizeUnits[m[2]] : null;
}

function rangeText(f: FlagDef): string {
  if (f.min !== undefined && f.max !== undefined)
    return ` from ${f.min} to ${f.max}`;
  if (f.min !== undefined) return ` of at least ${f.min}`;
  return "";
}

// Checks one value on its own. An empty value is allowed only for flags whose
// default is empty, meaning "omit the flag and use SPT's default".
export function validateFlagValue(f: FlagDef, value: FlagValue): string | null {
  if (f.kind === "bool")
    return typeof value === "boolean" ? null : "Choose on or off.";
  if (typeof value !== "string") return "Enter a value.";
  const v = value.trim();
  if (v === "") return f.default === "" ? null : "Enter a value.";
  switch (f.kind) {
    case "int":
    case "float": {
      const ok =
        f.kind === "int"
          ? /^-?[0-9]{1,9}$/.test(v)
          : /^-?[0-9]{1,9}(\.[0-9]+)?$/.test(v);
      const n = Number(v);
      if (
        !ok ||
        (f.min !== undefined && n < f.min) ||
        (f.max !== undefined && n > f.max)
      )
        return `Enter a ${f.kind === "int" ? "whole number" : "number"}${rangeText(f)}.`;
      return null;
    }
    case "size":
      return parseCliSize(v) !== null
        ? null
        : "Enter a size such as 5MiB, 64MiB or 1GiB.";
    case "duration":
      return durationPattern.test(v) && !/^[0.]+[a-zµ]+$/.test(v)
        ? null
        : "Enter a duration such as 500ms, 5s or 2m.";
    case "enum":
      return f.options?.includes(v)
        ? null
        : `Choose one of: ${f.options?.join(", ")}.`;
    case "string":
      if (f.name === "region")
        return regionPattern.test(v)
          ? null
          : "Use lowercase letters, digits and hyphens, e.g. us-east-1.";
      if (f.name === "endpoint-hostname")
        return hostnamePattern.test(v) ? null : "Enter a valid hostname.";
      return /\s/.test(v) || v.length > 255 ? "Enter a single word." : null;
  }
}

// Checks every preview-only flag of a workload, then the rules that tie flags
// together. Errors are keyed by the flag that should change.
export function validateAdvanced(
  workload: Workload,
  values: Record<string, FlagValue>,
  objectSize: string,
): FlagErrors {
  const errors: FlagErrors = {};
  const defs = flagsFor(workload).filter((f) => !f.core);
  for (const f of defs) {
    const message = validateFlagValue(f, values[f.name] ?? f.default);
    if (message) errors[f.name] = message;
  }
  const has = (name: string) => defs.some((f) => f.name === name);
  const text = (name: string) => {
    const v = values[name];
    return typeof v === "string" ? v.trim() : "";
  };
  const on = (name: string) => values[name] === true;
  const nonZero = (name: string) =>
    text(name) !== "" && Number(text(name)) !== 0;
  const add = (name: string, message: string) => {
    if (!errors[name]) errors[name] = message;
  };

  if (has("part-size")) {
    const part = text("part-size");
    for (const name of ["mpu-concurrent-objects", "mpu-concurrent-parts"])
      if (nonZero(name) && part === "") add(name, "Set a part size first.");
    const partBytes = parseCliSize(part);
    const objectBytes = parseSize(objectSize);
    if (partBytes !== null && objectBytes !== null && partBytes >= objectBytes)
      add("part-size", "Part size must be smaller than the object size.");
  }
  if (has("defer-verification") && on("defer-verification") && on("cleanup"))
    add(
      "defer-verification",
      "Deferred verification cannot be combined with cleanup.",
    );
  if (has("endpoint-selection")) {
    const mode = text("endpoint-selection") || "default";
    if (text("endpoint-hostname") !== "" && mode !== "round-robin")
      add("endpoint-hostname", "Only used with round-robin selection.");
    if (text("dns-timeout") !== "" && mode !== "per-request-dns")
      add("dns-timeout", "Only used with per-request DNS.");
    if (text("endpoint-connect-timeout") !== "" && mode === "default")
      add(
        "endpoint-connect-timeout",
        "Only used with round-robin or per-request DNS.",
      );
    if (mode !== "default" && (text("s3-driver") || "default") !== "default")
      add("endpoint-selection", "Endpoint selection needs the default driver.");
  }
  return errors;
}
