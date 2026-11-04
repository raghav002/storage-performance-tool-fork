import { describe, expect, it } from "vitest";
import { advancedDefaults, findFlag, type FlagValue } from "./schema";
import { parseCliSize, validateAdvanced, validateFlagValue } from "./validate";

const flag = (name: string) => {
  const f = findFlag("write-verify", name);
  if (!f) throw new Error(`no flag ${name}`);
  return f;
};
const wv = (changes: Record<string, FlagValue>, objectSize = "64MiB") =>
  validateAdvanced(
    "write-verify",
    { ...advancedDefaults("write-verify"), ...changes },
    objectSize,
  );

describe("validateFlagValue", () => {
  it("checks whole numbers against the flag's range", () => {
    expect(validateFlagValue(flag("min-hosts"), "3")).toBeNull();
    expect(validateFlagValue(flag("min-hosts"), "-1")).toMatch(/at least 0/);
    expect(validateFlagValue(flag("min-hosts"), "2.5")).toMatch(/whole number/);
    expect(validateFlagValue(flag("prefix-shards"), "-1")).toBeNull();
    expect(validateFlagValue(flag("prefix-shards"), "-2")).not.toBeNull();
  });

  it("checks decimals against the flag's range", () => {
    const f = flag("object-data-compressibility");
    expect(validateFlagValue(f, "37.5")).toBeNull();
    expect(validateFlagValue(f, "100")).toBeNull();
    expect(validateFlagValue(f, "100.1")).toMatch(/from 0 to 100/);
    expect(validateFlagValue(f, "abc")).not.toBeNull();
  });

  it("allows an empty value only where the default is empty", () => {
    expect(validateFlagValue(flag("part-size"), "")).toBeNull();
    expect(validateFlagValue(flag("checksum"), "")).toBeNull();
    expect(validateFlagValue(flag("min-hosts"), "")).toBe("Enter a value.");
  });

  it("accepts spt run sizes, including the legacy units", () => {
    const f = flag("part-size");
    for (const v of ["5MiB", "64MiB", "1GiB", "5MB", "512KB"])
      expect(validateFlagValue(f, v), v).toBeNull();
    for (const v of ["0MiB", "5 MiB", "5mb", "1.5MiB", "5"])
      expect(validateFlagValue(f, v), v).not.toBeNull();
    expect(parseCliSize("5MB")).toBe(5 * 2 ** 20);
  });

  it("accepts positive Go durations", () => {
    const f = flag("dns-timeout");
    for (const v of ["5s", "500ms", "1m30s", "1.5s"])
      expect(validateFlagValue(f, v), v).toBeNull();
    for (const v of ["5", "0s", "-5s", "5 s", "five"])
      expect(validateFlagValue(f, v), v).not.toBeNull();
  });

  it("limits choices to the listed options", () => {
    expect(validateFlagValue(flag("checksum"), "sha256")).toBeNull();
    expect(validateFlagValue(flag("checksum"), "md5")).toMatch(/crc32/);
    expect(validateFlagValue(flag("s3-driver"), "rdma")).not.toBeNull();
    expect(validateFlagValue(flag("cleanup"), "true")).toMatch(/on or off/);
  });

  it("checks regions and hostnames", () => {
    expect(validateFlagValue(flag("region"), "us-east-1")).toBeNull();
    expect(validateFlagValue(flag("region"), "US East")).not.toBeNull();
    const host = flag("endpoint-hostname");
    expect(validateFlagValue(host, "s3.example.com")).toBeNull();
    expect(validateFlagValue(host, "bad_host")).not.toBeNull();
  });
});

describe("validateAdvanced", () => {
  it("accepts the dashboard defaults for both workloads", () => {
    expect(wv({})).toEqual({});
    expect(validateAdvanced("mock", advancedDefaults("mock"), "1MiB")).toEqual(
      {},
    );
  });

  it("requires a part size for the multipart limits", () => {
    expect(wv({ "mpu-concurrent-parts": "4" })).toEqual({
      "mpu-concurrent-parts": "Set a part size first.",
    });
    expect(wv({ "mpu-concurrent-parts": "4", "part-size": "8MiB" })).toEqual(
      {},
    );
  });

  it("keeps the part size below the object size", () => {
    expect(wv({ "part-size": "64MiB" }, "64MiB")["part-size"]).toMatch(
      /smaller/,
    );
    expect(wv({ "part-size": "8MiB" }, "64MiB")).toEqual({});
    // An invalid object size is reported by the core checks, not here.
    expect(wv({ "part-size": "8MiB" }, "")).toEqual({});
  });

  it("rejects deferred verification together with cleanup", () => {
    expect(wv({ "defer-verification": true })["defer-verification"]).toMatch(
      /cleanup/,
    );
    expect(wv({ "defer-verification": true, cleanup: false })).toEqual({});
  });

  it("ties the routing options to their selection mode", () => {
    expect(wv({ "endpoint-hostname": "s3.example.com" })).toHaveProperty(
      "endpoint-hostname",
    );
    expect(
      wv({
        "endpoint-selection": "round-robin",
        "endpoint-hostname": "s3.example.com",
        "endpoint-connect-timeout": "10s",
      }),
    ).toEqual({});
    expect(
      wv({ "endpoint-selection": "round-robin", "dns-timeout": "2s" }),
    ).toHaveProperty("dns-timeout");
    expect(
      wv({ "endpoint-selection": "per-request-dns", "dns-timeout": "2s" }),
    ).toEqual({});
    expect(wv({ "endpoint-connect-timeout": "10s" })).toHaveProperty(
      "endpoint-connect-timeout",
    );
    expect(
      wv({ "endpoint-selection": "round-robin", "s3-driver": "aws" }),
    ).toHaveProperty("endpoint-selection");
  });

  it("reports a bad value once, before any cross-flag rule", () => {
    expect(wv({ "part-size": "lots" })).toEqual({
      "part-size": "Enter a size such as 5MiB, 64MiB or 1GiB.",
    });
  });
});
