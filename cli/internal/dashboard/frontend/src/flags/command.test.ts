import { describe, expect, it } from "vitest";
import {
  buildSptCommand,
  CommandError,
  parseSptCommand,
  tokenize,
} from "./command";
import { advancedDefaults } from "./schema";

const core = {
  object_count: 100,
  object_size: "64KiB",
  threads: 1,
  max_runtime_seconds: 60,
};

function problems(text: string): string[] {
  try {
    parseSptCommand(text);
  } catch (e) {
    if (e instanceof CommandError) return e.problems;
    throw e;
  }
  throw new Error("expected the command to be rejected");
}

describe("tokenize", () => {
  it("handles quotes, escapes and line continuations", () => {
    expect(
      tokenize(`spt run mock \\\n  --region "us east" --x='a b' c\\ d`),
    ).toEqual(["spt", "run", "mock", "--region", "us east", "--x=a b", "c d"]);
    expect(() => tokenize(`spt run "mock`)).toThrow(CommandError);
  });
});

describe("parseSptCommand", () => {
  it("reads core settings in long, short and inline forms", () => {
    const parsed = parseSptCommand(
      "./spt run write-verify -n 500 --object-size=4MiB -t 8 --auto-terminate-seconds 120",
    );
    expect(parsed.workload).toBe("write-verify");
    expect(parsed.core).toEqual({
      object_count: 500,
      object_size: "4MiB",
      threads: 8,
      max_runtime_seconds: 120,
    });
    expect(parsed.advanced).toEqual(advancedDefaults("write-verify"));
  });

  it("switches to the workload the command names", () => {
    const parsed = parseSptCommand("spt run mock --threads 4 --cleanup");
    expect(parsed.workload).toBe("mock");
    expect(parsed.core).toEqual({ threads: 4 });
    expect(parsed.advanced.cleanup).toBe(true);
    expect(parsed.flags).toEqual(["threads", "cleanup"]);
    expect(parseSptCommand("spt run mock").core).toEqual({});
  });

  it("reads booleans, negative numbers and advanced values", () => {
    const parsed = parseSptCommand(
      "spt run write-verify --cleanup=false --object-data-dedupable=0 --prefix-shards -1 --checksum sha256 --part-size 8MiB",
    );
    expect(parsed.advanced).toMatchObject({
      cleanup: false,
      "object-data-dedupable": false,
      "prefix-shards": "-1",
      checksum: "sha256",
      "part-size": "8MiB",
    });
  });

  it("rejects the whole command and lists every problem", () => {
    expect(
      problems(
        "spt run write-verify --access-key AKIA --endpoints https://s3 --threads 4 --shuffle --nope 1 extra",
      ),
    ).toEqual([
      expect.stringMatching(/^--access-key: Credentials come only/),
      expect.stringMatching(/^--endpoints: Set this in Storage configuration/),
      "--shuffle: not available for write-verify in the dashboard.",
      // "1" is read as the value of --nope, so it is not reported again.
      "--nope: not an spt run option.",
      'Unexpected argument "extra".',
    ]);
  });

  it("never echoes the value of a rejected flag", () => {
    const listed = problems("spt run mock -s TOPSECRETVALUE --threads 2").join(
      " ",
    );
    expect(listed).toMatch(/--secret-key/);
    expect(listed).not.toMatch(/TOPSECRETVALUE/);
  });

  it("rejects flags of the other workload", () => {
    expect(problems("spt run mock --checksum crc32")).toEqual([
      "--checksum: not available for mock in the dashboard.",
    ]);
  });

  it("rejects bad values, duplicates and missing values", () => {
    expect(problems("spt run mock --threads four")).toEqual([
      "--threads must be a whole number.",
    ]);
    expect(problems("spt run mock --threads 2 --threads 3")).toEqual([
      "--threads is set more than once.",
    ]);
    expect(problems("spt run mock --threads")).toEqual([
      "--threads needs a value.",
    ]);
    expect(problems("spt run mock --cleanup=maybe")).toEqual([
      "--cleanup must be true or false.",
    ]);
    expect(problems("spt run write-verify --checksum md5")[0]).toMatch(
      /^--checksum: Choose one of/,
    );
  });

  it("applies the cross-flag rules", () => {
    expect(
      problems("spt run write-verify --defer-verification --object-size 64MiB"),
    ).toEqual([
      "--defer-verification: Deferred verification cannot be combined with cleanup.",
    ]);
    expect(
      problems("spt run write-verify --object-size 4MiB --part-size 8MiB")[0],
    ).toMatch(/^--part-size: Part size must be smaller/);
  });

  it("names the supported workloads", () => {
    expect(problems("spt run read")).toEqual([
      "The dashboard runs write-verify and mock only, not read.",
    ]);
    expect(problems("spt run")).toEqual([
      "Name the workload: spt run write-verify or spt run mock.",
    ]);
    expect(problems("docker run mock")).toEqual([
      "Start with spt run write-verify or spt run mock.",
    ]);
  });
});

describe("buildSptCommand", () => {
  it("writes the core settings and only the changed flags", () => {
    expect(
      buildSptCommand("write-verify", core, advancedDefaults("write-verify")),
    ).toBe(
      "spt run write-verify --object-count 100 --object-size 64KiB --threads 1 --auto-terminate-seconds 60",
    );
    expect(
      buildSptCommand("write-verify", core, {
        ...advancedDefaults("write-verify"),
        cleanup: false,
        "save-items": true,
        region: "us-east-1",
      }),
    ).toBe(
      "spt run write-verify --object-count 100 --object-size 64KiB --threads 1 --auto-terminate-seconds 60 --cleanup=false --region us-east-1 --save-items",
    );
  });

  it("round-trips through the parser", () => {
    const advanced = {
      ...advancedDefaults("write-verify"),
      "part-size": "8MiB",
      "mpu-concurrent-parts": "4",
      "object-data-dedupable": false,
      "endpoint-selection": "round-robin",
      "endpoint-hostname": "s3.example.com",
    };
    const large = { ...core, object_size: "64MiB" };
    const text = buildSptCommand("write-verify", large, advanced);
    const parsed = parseSptCommand(text);
    expect(parsed.workload).toBe("write-verify");
    expect(parsed.core).toEqual(large);
    expect(parsed.advanced).toEqual(advanced);
  });
});
