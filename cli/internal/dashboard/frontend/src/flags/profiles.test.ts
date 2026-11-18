import { describe, expect, it } from "vitest";
import {
  cleanAdvanced,
  legacyProfileStorageKey,
  maxProfiles,
  profileStorageKey,
  readProfiles,
  saveProfile,
} from "./profiles";
import { advancedDefaults } from "./schema";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

const core = {
  mode: "expert" as const,
  object_count: 500,
  object_size: "4MiB",
  threads: 8,
  max_runtime_seconds: 120,
};

describe("expert profiles", () => {
  it("saves the workload, core settings and preview-only flags", () => {
    const storage = memoryStorage();
    const saved = saveProfile(storage, [], {
      name: "  nightly  ",
      workload: "mock",
      options: { ...core, driver: "mock" },
      advanced: { ...advancedDefaults("mock"), cleanup: true },
    });
    expect(saved).toEqual([
      {
        version: 2,
        name: "nightly",
        workload: "mock",
        options: core,
        advanced: { ...advancedDefaults("mock"), cleanup: true },
      },
    ]);
    expect(readProfiles(storage)).toEqual(saved);
  });

  it("replaces a profile with the same name and caps the list", () => {
    const storage = memoryStorage();
    let list = saveProfile(storage, [], {
      name: "a",
      workload: "write-verify",
      options: core,
      advanced: {},
    });
    list = saveProfile(storage, list, {
      name: "a",
      workload: "mock",
      options: core,
      advanced: {},
    });
    expect(list.map((p) => [p.name, p.workload])).toEqual([["a", "mock"]]);
    for (let i = 0; i < maxProfiles + 3; i++)
      list = saveProfile(storage, list, {
        name: `p${i}`,
        workload: "mock",
        options: core,
        advanced: {},
      });
    expect(list).toHaveLength(maxProfiles);
    expect(list[0].name).toBe(`p${maxProfiles + 2}`);
  });

  it("migrates profiles saved before expert flags existed", () => {
    const storage = memoryStorage({
      [legacyProfileStorageKey]: JSON.stringify([
        { name: "old", options: core },
        { name: "broken", options: { object_count: "many" } },
      ]),
    });
    expect(readProfiles(storage)).toEqual([
      {
        version: 2,
        name: "old",
        workload: "write-verify",
        options: core,
        advanced: advancedDefaults("write-verify"),
      },
    ]);
  });

  it("prefers saved v2 profiles over the old list", () => {
    const storage = memoryStorage({
      [profileStorageKey]: "[]",
      [legacyProfileStorageKey]: JSON.stringify([
        { name: "old", options: core },
      ]),
    });
    expect(readProfiles(storage)).toEqual([]);
  });

  it("drops unknown, blocked, core and invalid flags", () => {
    expect(
      cleanAdvanced("write-verify", {
        "save-items": true,
        "access-key": "AKIA",
        "secret-key": "s3cr3t",
        "object-count": "99",
        "made-up": "1",
        "min-hosts": "-4",
        checksum: "sha256",
      }),
    ).toEqual({
      ...advancedDefaults("write-verify"),
      "save-items": true,
      checksum: "sha256",
    });
    // A write-verify flag does not leak into a mock profile.
    expect(cleanAdvanced("mock", { checksum: "sha256" })).toEqual(
      advancedDefaults("mock"),
    );
  });

  it("ignores damaged storage", () => {
    expect(
      readProfiles(memoryStorage({ [profileStorageKey]: "{oops" })),
    ).toEqual([]);
    expect(
      readProfiles(
        memoryStorage({
          [profileStorageKey]: JSON.stringify([
            { name: "x", workload: "tables", options: core },
            "nonsense",
          ]),
        }),
      ),
    ).toEqual([]);
  });
});
