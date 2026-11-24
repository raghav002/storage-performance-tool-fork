import { describe, expect, it } from "vitest";
import { faq, suggest } from "./faq";
import { offTopic, onTopic } from "./faq.eval";
import { normalize } from "./matcher";

describe("help question bank", () => {
  it("has unique ids and complete entries", () => {
    const ids = faq.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of faq) {
      expect(entry.question.trim()).not.toBe("");
      expect(entry.alternates.length).toBeGreaterThan(0);
      expect(entry.answer.length).toBeGreaterThan(0);
      expect(entry.source.trim()).not.toBe("");
    }
  });

  it("never gives two entries the same phrasing", () => {
    const seen = new Map<string, string>();
    for (const entry of faq) {
      for (const text of [entry.question, ...entry.alternates]) {
        const key = normalize(text).join(" ");
        expect(seen.get(key) ?? entry.id, text).toBe(entry.id);
        seen.set(key, entry.id);
      }
    }
  });

  it("suggests each entry for its own question first", () => {
    for (const entry of faq) expect(suggest(entry.question)[0]).toBe(entry);
  });
});

describe("help suggestions on held-out questions", () => {
  it("has eval questions for every entry and only for known entries", () => {
    const ids = new Set(faq.map((entry) => entry.id));
    const covered = new Set(onTopic.map(([, id]) => id));
    expect([...covered].filter((id) => !ids.has(id))).toEqual([]);
    expect([...ids].filter((id) => !covered.has(id))).toEqual([]);
  });

  it("puts the right answer in the suggestions for at least 90%", () => {
    const misses = onTopic.filter(
      ([question, id]) => !suggest(question).some((entry) => entry.id === id),
    );
    expect(
      misses.length,
      misses.map(([q]) => q).join("; "),
    ).toBeLessThanOrEqual(Math.floor(onTopic.length * 0.1));
  });

  it("suggests nothing for questions the bank can't answer", () => {
    for (const question of offTopic)
      expect(suggest(question), question).toEqual([]);
  });
});
