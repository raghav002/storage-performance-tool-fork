// A small TF-IDF matcher for the help assistant. It ranks prewritten questions
// against what the user typed, entirely in the browser: no model, no network.
// It matches words and word fragments, not meaning, so each entry carries a few
// alternate phrasings and SYNONYMS folds common rewordings together.

export interface MatchEntry {
  id: string;
  question: string;
  alternates: string[];
}

export interface Match<T extends MatchEntry> {
  entry: T;
  score: number;
}

type Vector = Map<string, number>;

export interface MatchIndex<T extends MatchEntry> {
  entries: T[];
  phrasings: { entry: number; vector: Vector }[];
  idf: Map<string, number>;
  unseenIdf: number;
}

// Common words that carry no meaning for matching. Question words and "not"
// are kept because they change what is being asked.
const STOPWORDS = new Set(
  (
    "a an the and or but if then so of to in on at by for with from into " +
    "about as is are was were be been being am do does did doing have has " +
    "had i me my mine we our you your it its this that these those there " +
    "here can could would should will shall may might must just please " +
    "get got any some all also too very really still one"
  ).split(" "),
);

// Rewordings folded onto one term after stemming. Keys and values are stemmed
// at load time, so they can be written as plain words.
const SYNONYM_GROUPS: Record<string, string[]> = {
  stop: ["halt", "cancel", "abort", "kill", "end", "terminate", "interrupt"],
  delete: ["remove", "erase", "wipe", "gone", "missing", "disappear", "vanish"],
  credential: ["password", "secret", "login", "access", "key", "keys"],
  run: ["benchmark", "test", "job", "workload"],
  result: ["output", "artifact", "artefact"],
  machine: ["host", "node", "client", "server", "vm"],
  start: ["launch", "begin", "kick"],
  log: ["logs", "error", "errors", "message"],
  setting: ["option", "config", "configuration", "parameter", "limit"],
  dashboard: ["gui", "ui", "console", "page", "app"],
  compare: ["comparison", "diff", "versus", "vs"],
  slow: ["stuck", "hang", "hanging", "forever", "long"],
};

/** Strips common English suffixes so word forms share one feature. */
export function stem(word: string): string {
  let w = word;
  if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith("ed")) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss"))
    return w.slice(0, -1);
  else return w;
  // "stopping" -> "stopp" -> "stop", but "access" and "full" stay whole.
  const last = w[w.length - 1];
  if (w.length > 3 && last === w[w.length - 2] && !/[aeiouls]/.test(last))
    w = w.slice(0, -1);
  return w;
}

const SYNONYMS = new Map<string, string>();
for (const [term, words] of Object.entries(SYNONYM_GROUPS)) {
  for (const word of words) SYNONYMS.set(stem(word), stem(term));
}

/** Lowercases, drops punctuation and stopwords, stems and folds synonyms. */
export function normalize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((word) => word && !STOPWORDS.has(word))
    .map((word) => {
      const stemmed = stem(word);
      return SYNONYMS.get(stemmed) ?? stemmed;
    });
}

// Feature weights: whole words and word pairs count fully; character
// trigrams only nudge, so a typo still lands near the right entry.
const WORD = 1,
  BIGRAM = 0.6,
  TRIGRAM = 0.25;

function features(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  const add = (key: string, weight: number) =>
    counts.set(key, (counts.get(key) ?? 0) + weight);
  const tokens = normalize(text);
  tokens.forEach((token, i) => {
    add("w:" + token, WORD);
    if (i > 0) add("b:" + tokens[i - 1] + " " + token, BIGRAM);
    const padded = "#" + token + "#";
    for (let j = 0; j + 3 <= padded.length; j++)
      add("c:" + padded.slice(j, j + 3), TRIGRAM);
  });
  return counts;
}

function weigh(counts: Map<string, number>, idf: (key: string) => number) {
  const vector: Vector = new Map();
  let norm = 0;
  for (const [key, count] of counts) {
    const weight = count * idf(key);
    vector.set(key, weight);
    norm += weight * weight;
  }
  norm = Math.sqrt(norm);
  if (norm > 0)
    for (const [key, weight] of vector) vector.set(key, weight / norm);
  return vector;
}

/** Builds one TF-IDF vector per phrasing (the question and each alternate). */
export function buildIndex<T extends MatchEntry>(entries: T[]): MatchIndex<T> {
  const raw: { entry: number; counts: Map<string, number> }[] = [];
  entries.forEach((entry, i) => {
    for (const text of [entry.question, ...entry.alternates])
      raw.push({ entry: i, counts: features(text) });
  });
  const df = new Map<string, number>();
  for (const { counts } of raw)
    for (const key of counts.keys()) df.set(key, (df.get(key) ?? 0) + 1);
  const n = raw.length;
  const idf = new Map<string, number>();
  for (const [key, count] of df)
    idf.set(key, Math.log((1 + n) / (1 + count)) + 1);
  // Words never seen in the bank get the highest weight, so a question that is
  // mostly about something else scores low.
  const unseenIdf = Math.log(1 + n) + 1;
  const lookup = (key: string) => idf.get(key) ?? unseenIdf;
  return {
    entries,
    phrasings: raw.map(({ entry, counts }) => ({
      entry,
      vector: weigh(counts, lookup),
    })),
    idf,
    unseenIdf,
  };
}

function cosine(a: Vector, b: Vector) {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [key, weight] of small) dot += weight * (large.get(key) ?? 0);
  return dot;
}

/** Scores every entry; an entry's score is its best-matching phrasing. */
export function scoreAll<T extends MatchEntry>(
  index: MatchIndex<T>,
  query: string,
): Match<T>[] {
  const counts = features(query);
  if (counts.size === 0) return [];
  const vector = weigh(counts, (key) => index.idf.get(key) ?? index.unseenIdf);
  const best = new Array<number>(index.entries.length).fill(0);
  for (const phrasing of index.phrasings)
    best[phrasing.entry] = Math.max(
      best[phrasing.entry],
      cosine(vector, phrasing.vector),
    );
  return best
    .map((score, i) => ({ entry: index.entries[i], score }))
    .sort((a, b) => b.score - a.score);
}

/** Returns up to topK entries scoring at least threshold, best first. */
export function match<T extends MatchEntry>(
  index: MatchIndex<T>,
  query: string,
  { topK = 3, threshold }: { topK?: number; threshold: number },
): Match<T>[] {
  return scoreAll(index, query)
    .filter((m) => m.score >= threshold)
    .slice(0, topK);
}
