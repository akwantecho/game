import { describe, expect, it } from "vitest";
import { CELLS, N, findWinPath, normalizeAnswer, type Seat } from "../shared/game";

describe("normalizeAnswer", () => {
  it("folds alef forms, taa marbuta, alef maqsura, diacritics and a leading ال", () => {
    expect(normalizeAnswer("  آسيا ")).toBe(normalizeAnswer("اسيا"));
    expect(normalizeAnswer("القاهرة")).toBe(normalizeAnswer("قاهره"));
    expect(normalizeAnswer("عمّان")).toBe(normalizeAnswer("عمان"));
    expect(normalizeAnswer("ظبى")).toBe(normalizeAnswer("ظبي"));
    expect(normalizeAnswer("بيروت")).not.toBe(normalizeAnswer("بغداد"));
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
});
