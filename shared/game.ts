// Board rules shared by the server (authoritative) and the client (rendering).
// Ported from the Claude Design prototype `Online Match Mobile.dc.html`.

export const N = 5;
export const CELLS = N * N;

/** Seat 0 hosts the room and links right ↔ left; seat 1 joins and links top ↕ bottom. */
export type Seat = 0 | 1;

export const GOALS = ["من اليمين إلى اليسار", "من الأعلى إلى الأسفل"] as const;
export const GOALS_SHORT = ["يمين ↔ يسار", "أعلى ↕ أسفل"] as const;

/** Strip diacritics/tatweel and fold alef, taa marbuta, alef maqsura and a leading «ال». */
export const normalizeAnswer = (s: string): string =>
  (s || "")
    .trim()
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ")
    .replace(/^ال/, "");

/** Neighbours on the offset hex grid (odd rows shifted half a cell). */
export const neighbours = (r: number, c: number): [number, number][] => {
  const d =
    r % 2
      ? [[-1, 0], [-1, 1], [0, -1], [0, 1], [1, 0], [1, 1]]
      : [[-1, -1], [-1, 0], [0, -1], [0, 1], [1, -1], [1, 0]];
  return d
    .map(([a, b]) => [r + a, c + b] as [number, number])
    .filter(([x, y]) => x >= 0 && y >= 0 && x < N && y < N);
};

/** Shortest connected path of `seat`'s cells between its two edges, or null. */
export function findWinPath(owners: (Seat | null)[], seat: Seat): number[] | null {
  const isEnd = (r: number, c: number) => (seat === 0 ? c === N - 1 : r === N - 1);
  const start: [number, number][] = [];
  for (let k = 0; k < N; k++) {
    const [r, c] = seat === 0 ? [k, 0] : [0, k];
    if (owners[r * N + c] === seat) start.push([r, c]);
  }
  const prev = new Map<number, number>();
  const seen = new Set(start.map(([r, c]) => r * N + c));
  const queue = start.slice();
  while (queue.length) {
    const [r, c] = queue.shift()!;
    if (isEnd(r, c)) {
      const out: number[] = [];
      let k: number | undefined = r * N + c;
      while (k !== undefined) {
        out.push(k);
        k = prev.get(k);
      }
      return out;
    }
    for (const [x, y] of neighbours(r, c)) {
      const k = x * N + y;
      if (!seen.has(k) && owners[k] === seat) {
        seen.add(k);
        prev.set(k, r * N + c);
        queue.push([x, y]);
      }
    }
  }
  return null;
}

// Room codes avoid look-alike characters (no I, L, O, 0, 1).
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 5;
export const TIME_LIMITS = [10, 20, 30] as const;
export const RESULT_MS = 2200;
