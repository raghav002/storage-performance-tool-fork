import { describe, expect, it } from "vitest";
import { buildIndex, match, normalize, scoreAll, stem } from "./matcher";

const bank = [
  {
    id: "stop",
    question: "How do I stop a run?",
    alternates: ["End a benchmark early"],
  },
  {
    id: "port",
    question: "How do I change the dashboard port?",
    alternates: ["Port 8000 is already in use"],
  },
  {
    id: "mock",
    question: "What is the mock driver?",
    alternates: ["Run without S3 storage"],
  },
];
const index = buildIndex(bank);

describe("stem", () => {
  it("folds common word forms onto one stem", () => {
    expect(stem("stopping")).toBe("stop");
    expect(stem("stopped")).toBe("stop");
    expect(stem("stops")).toBe("stop");
    expect(stem("entries")).toBe("entry");
    expect(stem("access")).toBe("access");
  });
});

describe("normalize", () => {
  it("drops punctuation and stopwords and folds synonyms", () => {
    expect(normalize("How can I HALT the benchmark?!")).toEqual([
      "how",
      "stop",
      "run",
    ]);
  });

  it("keeps question words and negation", () => {
    expect(normalize("why not")).toEqual(["why", "not"]);
  });

  it("returns nothing for stopwords only", () => {
    expect(normalize("is it the")).toEqual([]);
  });
});

describe("match", () => {
  it("finds an entry from a reworded question", () => {
    const [top] = match(index, "cancel my running test", { threshold: 0.1 });
    expect(top.entry.id).toBe("stop");
  });

  it("tolerates a typo through character trigrams", () => {
    const [top] = match(index, "change the dashbaord port", { threshold: 0.1 });
    expect(top.entry.id).toBe("port");
  });

  it("drops entries below the threshold and caps the count", () => {
    expect(
      match(index, "weather forecast tomorrow", { threshold: 0.3 }),
    ).toEqual([]);
    expect(match(index, "port", { threshold: 0, topK: 2 })).toHaveLength(2);
  });

  it("returns nothing for an empty or stopword-only query", () => {
    expect(match(index, "", { threshold: 0 })).toEqual([]);
    expect(match(index, "is it the", { threshold: 0 })).toEqual([]);
  });

  it("scores an exact question as a near-perfect match", () => {
    const [top] = scoreAll(index, "What is the mock driver?");
    expect(top.entry.id).toBe("mock");
    expect(top.score).toBeGreaterThan(0.99);
  });
});
