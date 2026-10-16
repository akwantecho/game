import { describe, expect, it } from "vitest";
import {
  DEFAULT_RULES,
  answerHint,
  answerMatches,
  findWinPath,
  normalizeAnswer,
  presetOf,
  sanitizeRules,
  type Seat,
} from "../shared/game";

const N = 5;
const CELLS = N * N;

describe("normalizeAnswer", () => {
  it("folds alef forms, taa marbuta, alef maqsura, diacritics and a leading ال", () => {
    expect(normalizeAnswer("  آسيا ")).toBe(normalizeAnswer("اسيا"));
    expect(normalizeAnswer("القاهرة")).toBe(normalizeAnswer("قاهره"));
    expect(normalizeAnswer("عمّان")).toBe(normalizeAnswer("عمان"));
    expect(normalizeAnswer("ظبى")).toBe(normalizeAnswer("ظبي"));
    expect(normalizeAnswer("بيروت")).not.toBe(normalizeAnswer("بغداد"));
  });
  it("folds hamza carriers and Arabic-Indic digits, strips punctuation", () => {
    expect(normalizeAnswer("مُؤسِّس")).toBe(normalizeAnswer("موسس"));
    expect(normalizeAnswer("شيْء")).toBe(normalizeAnswer("شي"));
    expect(normalizeAnswer("٨")).toBe("8");
    expect(normalizeAnswer("القاهرة!؟")).toBe(normalizeAnswer("قاهره"));
  });
});

describe("answerMatches", () => {
  it("accepts exact and space-insensitive matches", () => {
    expect(answerMatches("القاهرة", ["القاهرة"])).toBe(true);
    expect(answerMatches("عبدالله", ["عبد الله"])).toBe(true);
    expect(answerMatches("أنقره", ["أنقرة"])).toBe(true);
  });
  it("forgives a typo in a long word", () => {
    expect(answerMatches("نيتروجين", ["النيتروجين"])).toBe(true); // ال stripped
    expect(answerMatches("مندليف", ["مندلييف"])).toBe(true); // one missing letter
    expect(answerMatches("الاكسجين", ["الأكسجين"])).toBe(true);
  });
  it("rejects a different word and a slip in a short word", () => {
    expect(answerMatches("بغداد", ["بيروت"])).toBe(false);
    expect(answerMatches("قلم", ["قلب"])).toBe(false); // 3 letters: must be exact
    expect(answerMatches("", ["تمر"])).toBe(false);
  });
  it("will not turn a near-miss into a word starting with another letter", () => {
    expect(answerMatches("ساهره", ["قاهره"])).toBe(false);
  });
});

describe("findWinPath", () => {
  const board = (cells: number[], seat: Seat) => {
    const o: (Seat | null)[] = Array(CELLS).fill(null);
    for (const i of cells) o[i] = seat;
    return o;
  };
  it("seat 0 wins with a row linking right and left edges", () => {
    const row = [10, 11, 12, 13, 14];
    expect(findWinPath(board(row, 0), 0)?.sort()).toEqual(row);
    expect(findWinPath(board(row, 0), 1)).toBeNull();
  });
  it("seat 1 wins with a top-to-bottom zigzag through hex neighbours", () => {
    // col 2 straight down is connected on this offset grid
    const col = Array.from({ length: N }, (_, r) => r * N + 2);
    expect(findWinPath(board(col, 1), 1)).toHaveLength(N);
  });
  it("a gap blocks the win", () => {
    expect(findWinPath(board([10, 11, 13, 14], 0), 0)).toBeNull();
  });
  it("reads the board size from the cell count", () => {
    const at = (n: number, cells: number[], seat: Seat) => {
      const o: (Seat | null)[] = Array(n * n).fill(null);
      for (const i of cells) o[i] = seat;
      return findWinPath(o, seat);
    };
    expect(at(4, [4, 5, 6, 7], 0)).toHaveLength(4);
    expect(at(4, [4, 5, 6], 0)).toBeNull();
    expect(at(6, [2, 8, 14, 20, 26, 32], 1)).toHaveLength(6);
  });
});

describe("rules", () => {
  it("keeps valid values and falls back on the rest", () => {
    expect(sanitizeRules(undefined)).toEqual(DEFAULT_RULES);
    const r = sanitizeRules({ timeLimit: 30, size: 6, mode: "buzzer", steal: true, penalty: "gift", powers: "yes", size2: 9 });
    expect(r).toEqual({ ...DEFAULT_RULES, timeLimit: 30, size: 6, mode: "buzzer", steal: true, penalty: "gift" });
    expect(sanitizeRules({ timeLimit: 15, size: 7, mode: "chaos" })).toEqual(DEFAULT_RULES);
  });
  it("merges a patch over the current rules", () => {
    const base = sanitizeRules({ size: 4, powers: true });
    expect(sanitizeRules({ steal: true }, base)).toEqual({ ...base, steal: true });
  });
  it("names the preset the rules match", () => {
    expect(presetOf(DEFAULT_RULES)).toBe("classic");
    expect(presetOf({ ...DEFAULT_RULES, mode: "buzzer", steal: true, size: 6 })).toBe("show");
    expect(presetOf({ ...DEFAULT_RULES, powers: true })).toBeNull();
  });
});

describe("answerHint", () => {
  it("shows the first letter and a blank per remaining letter", () => {
    expect(answerHint("بيروت")).toEqual({ mask: "ب _ _ _ _", letters: 5 });
  });
  it("drops a leading ال and the diacritics", () => {
    expect(answerHint("القاهرة")).toEqual({ mask: "ق _ _ _ _", letters: 5 });
    expect(answerHint("عمّان").letters).toBe(4);
  });
  it("keeps the word breaks", () => {
    expect(answerHint("نجيب محفوظ")).toEqual({ mask: "ن _ _ _   _ _ _ _ _", letters: 9 });
  });
});
