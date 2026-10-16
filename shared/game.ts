// Board rules shared by the server (authoritative) and the client (rendering).
// Ported from the Claude Design prototype `Online Match Mobile.dc.html`.

/** Seat 0 hosts the room and links right ↔ left; seat 1 joins and links top ↕ bottom. */
export type Seat = 0 | 1;

export const GOALS = ["من اليمين إلى اليسار", "من الأعلى إلى الأسفل"] as const;
export const GOALS_SHORT = ["يمين ↔ يسار", "أعلى ↕ أسفل"] as const;

// ── match rules (the host sets them in the lobby) ──────────────────────────

export const TIME_LIMITS = [10, 20, 30] as const;
export const SIZES = [4, 5, 6] as const;
export const ROUNDS = [1, 3, 5] as const;
export type Mode = "turns" | "buzzer";
export type Penalty = "none" | "lock" | "gift";
export type PowerKind = "skip" | "time" | "hint";
export type Special = "gold" | "bomb" | "fast";

export interface Rules {
  /** Seconds to answer (and, in buzzer mode, to buzz). */
  timeLimit: number;
  /** The board is size × size cells. */
  size: number;
  /** Best-of series length: first to win more than half the rounds takes the match. */
  rounds: number;
  /** "turns": the picker answers. "buzzer": both see the question and the first to buzz answers. */
  mode: Mode;
  /** A missed question passes to the other player for a shorter second try. */
  steal: boolean;
  /** Gold, bomb and fast cells are scattered over the board. */
  specials: boolean;
  /** Each player may skip a question, add time and ask for a hint, once per match. */
  powers: boolean;
  /** After picking a letter, the picker chooses the question's category. */
  categories: boolean;
  /** What a miss costs: nothing, the cell locked for one turn, or the cell handed to the opponent. */
  penalty: Penalty;
}

export const DEFAULT_RULES: Rules = {
  timeLimit: 20,
  size: 5,
  rounds: 3,
  mode: "turns",
  steal: false,
  specials: false,
  powers: false,
  categories: false,
  penalty: "none",
};

type Variant = Omit<Rules, "timeLimit" | "size" | "rounds">;
export const PRESETS: { id: string; name: string; rules: Variant }[] = [
  { id: "classic", name: "كلاسيكي", rules: { mode: "turns", steal: false, specials: false, powers: false, categories: false, penalty: "none" } },
  { id: "show", name: "حروف", rules: { mode: "buzzer", steal: true, specials: false, powers: false, categories: false, penalty: "none" } },
  { id: "chaos", name: "فوضى", rules: { mode: "turns", steal: true, specials: true, powers: true, categories: true, penalty: "lock" } },
];

export const presetOf = (r: Rules) =>
  PRESETS.find((p) => (Object.keys(p.rules) as (keyof Variant)[]).every((k) => p.rules[k] === r[k]))?.id ?? null;

const pick = <T>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);
const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);

/** Merge untrusted input over `base`, keeping only valid values. */
export function sanitizeRules(input: unknown, base: Rules = DEFAULT_RULES): Rules {
  const r = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  return {
    timeLimit: pick(Number(r.timeLimit), TIME_LIMITS, base.timeLimit),
    size: pick(Number(r.size), SIZES, base.size),
    rounds: pick(Number(r.rounds), ROUNDS, base.rounds),
    mode: pick(r.mode, ["turns", "buzzer"] as const, base.mode),
    steal: bool(r.steal, base.steal),
    specials: bool(r.specials, base.specials),
    powers: bool(r.powers, base.powers),
    categories: bool(r.categories, base.categories),
    penalty: pick(r.penalty, ["none", "lock", "gift"] as const, base.penalty),
  };
}

/** Plain-language lines for the rules that differ from a classic match. */
export function describeRules(r: Rules): string[] {
  const out = [
    r.mode === "buzzer"
      ? "الجرس: كلاكما يرى السؤال، وأول من يضغط الجرس يجيب."
      : "بالدور: صاحب الدور يختار الحرف ويجيب عليه.",
  ];
  if (r.steal && r.penalty !== "gift") out.push("السرقة: إذا أخطأ أحدكما، يحصل الآخر على فرصة ثانية بوقت أقصر.");
  if (r.specials) out.push("خلايا خاصة: ★ الذهبية تمنح دوراً إضافياً، ● القنبلة تُخسرك خلية إن أخطأت، ⚡ الخاطفة بنصف الوقت.");
  if (r.powers) out.push(`قوى مساعدة: تخطي السؤال، +${POWER_TIME_S} ثوانٍ، وتلميح. كل واحدة مرة في المباراة.`);
  if (r.categories) out.push("اختيار المجال: بعد اختيار الحرف تختار مجال السؤال.");
  if (r.penalty === "lock") out.push("عقوبة الخطأ: تُقفل الخلية في الدور التالي.");
  if (r.penalty === "gift") out.push("عقوبة الخطأ: تذهب الخلية إلى الخصم.");
  if (r.rounds > 1) out.push(`مباراة من ${r.rounds} جولات: الفائز من يكسب أكثرها.`);
  return out;
}

// Answer windows. A fast cell halves each one, down to FAST_MIN_MS.
export const BUZZ_ANSWER_S = 10;
export const POWER_TIME_S = 10;
const FAST_MIN_MS = 5000;
export const stealMs = (timeLimit: number) => Math.max(8000, timeLimit * 500);
export const fastMs = (ms: number) => Math.max(FAST_MIN_MS, Math.round(ms / 2));

export const SPECIALS: Record<Special, { name: string; note: string; glyph: string }> = {
  gold: { name: "ذهبية", note: "دور إضافي لمن يأخذها", glyph: "★" },
  bomb: { name: "قنبلة", note: "الخطأ فيها يُخسرك خلية", glyph: "●" },
  fast: { name: "خاطفة", note: "نصف الوقت", glyph: "⚡" },
};

/** Special cells of each kind on a board of `size`. */
export const specialCount = (size: number) => (size <= 4 ? 1 : size === 5 ? 2 : 3);

/** A hint that never gives the answer away: its first letter and one blank per remaining letter. */
export function answerHint(answer: string): { mask: string; letters: number } {
  const words = answer
    .replace(/[\p{M}ـ]/gu, "")
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => [...(i === 0 ? w.replace(/^ال(?=..)/, "") : w)]);
  return {
    mask: words.map((w, i) => w.map((ch, j) => (i === 0 && j === 0 ? ch : "_")).join(" ")).join("   "),
    letters: words.reduce((n, w) => n + w.length, 0),
  };
}

/** Strip diacritics/tatweel and fold alef, taa marbuta, alef maqsura and a leading «ال». */
export const normalizeAnswer = (s: string): string =>
  (s || "")
    .trim()
    .replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d).toString())
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ء/g, "")
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ")
    .replace(/^ال/, "");

/** Edit distance between two strings, short-circuited past 2 (our max tolerance). */
const editDistance = (a: string, b: string): number => {
  if (Math.abs(a.length - b.length) > 2) return 3;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
};

/** Typos forgiven by answer length: short words must be exact (a one-letter
 * slip there is a different word), longer words forgive one or two. */
const typoTolerance = (len: number): number => (len <= 4 ? 0 : len <= 7 ? 1 : 2);

/**
 * Does a player's answer count as one of the accepted answers? Matches when,
 * after normalisation, it is identical, identical ignoring spaces, or within a
 * length-scaled edit distance — but typo tolerance only applies when the first
 * letter agrees, so a near-miss can never be graded as a different word.
 */
export function answerMatches(given: string, accepted: readonly string[]): boolean {
  const g = normalizeAnswer(given);
  if (!g) return false;
  const gNoSpace = g.replace(/ /g, "");
  for (const a of accepted) {
    const n = normalizeAnswer(a);
    if (!n) continue;
    if (g === n) return true;
    const nNoSpace = n.replace(/ /g, "");
    if (gNoSpace === nNoSpace) return true;
    if (gNoSpace[0] === nNoSpace[0]) {
      const tol = typoTolerance(Math.max(gNoSpace.length, nNoSpace.length));
      if (tol > 0 && editDistance(gNoSpace, nNoSpace) <= tol) return true;
    }
  }
  return false;
}

/** Neighbours on the offset hex grid (odd rows shifted half a cell). */
export const neighbours = (r: number, c: number, n: number): [number, number][] => {
  const d =
    r % 2
      ? [[-1, 0], [-1, 1], [0, -1], [0, 1], [1, 0], [1, 1]]
      : [[-1, -1], [-1, 0], [0, -1], [0, 1], [1, -1], [1, 0]];
  return d
    .map(([a, b]) => [r + a, c + b] as [number, number])
    .filter(([x, y]) => x >= 0 && y >= 0 && x < n && y < n);
};

/** Shortest connected path of `seat`'s cells between its two edges, or null. The board is square. */
export function findWinPath(owners: (Seat | null)[], seat: Seat): number[] | null {
  const N = Math.round(Math.sqrt(owners.length));
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
    for (const [x, y] of neighbours(r, c, N)) {
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
export const RESULT_MS = 2200;
/** Extra reading time when a turn had a steal or a special effect. */
export const RESULT_EXTRA_MS = 1000;
