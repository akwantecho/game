import { randomBytes, randomInt } from "node:crypto";
import {
  BUZZ_ANSWER_S,
  POWER_TIME_S,
  RESULT_EXTRA_MS,
  RESULT_MS,
  answerHint,
  answerMatches,
  fastMs,
  findWinPath,
  normalizeAnswer,
  sanitizeRules,
  specialCount,
  stealMs,
  type PowerKind,
  type Rules,
  type Seat,
  type Special,
} from "../shared/game";
import type { Attempt, Phase, RoomView, TurnResult } from "../shared/protocol";
import { BANK, type Question } from "./questions";

/** Answers that arrive this long after the deadline still count (network latency). */
export const ANSWER_GRACE_MS = 400;
export const MAX_NAME = 20;
export const MAX_ANSWER = 60;

const POWER_KINDS: readonly PowerKind[] = ["skip", "time", "hint"];
const SPECIAL_KINDS: readonly Special[] = ["gold", "bomb", "fast"];
const LETTERS = [...new Set(BANK.filter((q) => q.isActive).map((q) => q.letter))];
/** Two questions with the same answer on the same letter feel like a repeat. */
const answerKey = (q: Question) => `${q.letter}:${normalizeAnswer(q.answer)}`;

interface Player {
  name: string;
  token: string;
  connections: number;
}

type Powers = Record<PowerKind, boolean>;
type Hint = ReturnType<typeof answerHint>;

interface Game {
  size: number;
  letters: string[];
  specials: (Special | null)[];
  owners: (Seat | null)[];
  /** Cells nobody may pick this turn. */
  locked: number[];
  /** Whose turn it is to pick. */
  current: Seat;
  turn: number;
  phase: Phase;
  active: number | null;
  category: string | null;
  categories: string[];
  q: Question | null;
  answerer: Seat | null;
  stealing: boolean;
  attempts: Attempt[];
  deadline: number;
  windowMs: number;
  hints: [Hint | null, Hint | null];
  powers: [Powers, Powers];
  result: TurnResult | null;
  winPath: number[];
  winner: Seat | null;
  stats: [{ c: number; w: number }, { c: number; w: number }];
}

function shuffle<T>(xs: T[]): T[] {
  const a = xs.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function newGame(rules: Rules): Game {
  const cells = rules.size * rules.size;
  // Each letter once while they last; a 6×6 board repeats a few, none more than twice.
  const letters = shuffle([...shuffle(LETTERS), ...shuffle(LETTERS)].slice(0, cells));
  const specials: (Special | null)[] = Array(cells).fill(null);
  if (rules.specials) {
    const k = specialCount(rules.size);
    shuffle([...Array(cells).keys()])
      .slice(0, k * SPECIAL_KINDS.length)
      .forEach((cell, i) => (specials[cell] = SPECIAL_KINDS[Math.floor(i / k)]));
  }
  const noPowers = (): Powers => ({ skip: false, time: false, hint: false });
  return {
    size: rules.size,
    letters,
    specials,
    owners: Array(cells).fill(null),
    locked: [],
    current: 0,
    turn: 1,
    phase: "pick",
    active: null,
    category: null,
    categories: [],
    q: null,
    answerer: null,
    stealing: false,
    attempts: [],
    deadline: 0,
    windowMs: 0,
    hints: [null, null],
    powers: [noPowers(), noPowers()],
    result: null,
    winPath: [],
    winner: null,
    stats: [{ c: 0, w: 0 }, { c: 0, w: 0 }],
  };
}

export const cleanName = (s: unknown) => (typeof s === "string" ? s.trim().replace(/\s+/g, " ").slice(0, MAX_NAME) : "");

/**
 * One match between two phones. The server is the only source of truth: it
 * picks questions, runs the clock and grades answers. `onChange` fires after
 * every state change so the transport can push fresh views to both seats.
 */
export class Room {
  readonly players: [Player, Player | null];
  rules: Rules;
  stage: "lobby" | "game" = "lobby";
  game: Game;
  /** Best-of series: current round (1-based) and rounds won by each seat. */
  round = 1;
  wins: [number, number] = [0, 0];
  lastActive = Date.now();
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** When each question was asked in this room (a running count). Kept across rematches. */
  private asked = new Map<string, number>();
  private asks = 0;
  private answersSeen = new Set<string>();

  constructor(
    readonly code: string,
    hostName: string,
    rules: unknown,
    private onChange: (room: Room) => void,
  ) {
    this.players = [{ name: hostName, token: token(), connections: 0 }, null];
    this.rules = sanitizeRules(rules);
    this.game = newGame(this.rules);
  }

  private changed() {
    this.lastActive = Date.now();
    this.onChange(this);
  }

  seatFor(tok: string): Seat | null {
    if (this.players[0].token === tok) return 0;
    if (this.players[1]?.token === tok) return 1;
    return null;
  }

  join(name: string): { seat: Seat; token: string } | "room_full" | "name_taken" {
    if (this.players[1]) return "room_full";
    if (normalizeAnswer(name) === normalizeAnswer(this.players[0].name)) return "name_taken";
    const p = { name, token: token(), connections: 0 };
    this.players[1] = p;
    this.changed();
    return { seat: 1, token: p.token };
  }

  /** Guest leaving the lobby frees the seat. Anything else closes the room (returns true). */
  leave(seat: Seat): boolean {
    if (seat === 1 && this.stage === "lobby") {
      this.players[1] = null;
      this.changed();
      return false;
    }
    this.dispose();
    return true;
  }

  setConnected(seat: Seat, delta: 1 | -1) {
    const p = this.players[seat];
    if (!p) return;
    p.connections = Math.max(0, p.connections + delta);
    this.changed();
  }

  /** The host tunes the rules while waiting in the lobby. */
  setRules(seat: Seat, patch: unknown) {
    if (seat !== 0 || this.stage !== "lobby") return;
    this.rules = sanitizeRules(patch, this.rules);
    this.game = newGame(this.rules);
    this.changed();
  }

  start(seat: Seat) {
    if (seat !== 0 || this.stage !== "lobby" || !this.players[1]) return;
    this.stage = "game";
    this.round = 1;
    this.wins = [0, 0];
    this.game = newGame(this.rules);
    this.changed();
  }

  /** Rounds one seat must win to take the series (a majority). */
  private get needed() {
    return Math.floor(this.rules.rounds / 2) + 1;
  }

  /** True once the current round's win settles the series. */
  get sessionOver() {
    return this.wins[0] >= this.needed || this.wins[1] >= this.needed || this.round >= this.rules.rounds;
  }

  /** The series champion, or null while it's still level. */
  get sessionWinner(): Seat | null {
    return this.wins[0] > this.wins[1] ? 0 : this.wins[1] > this.wins[0] ? 1 : null;
  }

  /** After a won round: the next round, or a fresh series once this one is over. */
  rematch() {
    if (this.stage !== "game" || this.game.phase !== "won") return;
    this.clearTimer();
    if (this.sessionOver) {
      this.round = 1;
      this.wins = [0, 0];
    } else {
      this.round++;
    }
    this.game = newGame(this.rules);
    this.changed();
  }

  pick(seat: Seat, cell: number) {
    const g = this.game;
    if (this.stage !== "game" || g.phase !== "pick" || seat !== g.current) return;
    if (!Number.isInteger(cell) || cell < 0 || cell >= g.owners.length || g.owners[cell] !== null) return;
    if (this.locks().includes(cell)) return;
    g.active = cell;
    g.q = null;
    // Only categories that still have a question nobody here has seen.
    const pool = this.pool(null);
    const fresh = pool.filter((q) => !this.asked.has(q.id));
    const categories = [...new Set((fresh.length ? fresh : pool).map((q) => q.category))];
    if (this.rules.categories && categories.length > 1) {
      Object.assign(g, { phase: "category", categories });
      return this.changed();
    }
    this.ask(null);
  }

  chooseCategory(seat: Seat, name: string) {
    const g = this.game;
    if (this.stage !== "game" || g.phase !== "category" || seat !== g.current || !g.categories.includes(name)) return;
    this.ask(name);
  }

  /** Open a question on the active cell: to the picker, or to whoever buzzes first. */
  private ask(category: string | null) {
    const g = this.game;
    const q = this.draw(category)!; // every board letter comes from the bank
    this.remember(q);
    const buzzer = this.rules.mode === "buzzer";
    Object.assign(g, {
      phase: buzzer ? "buzz" : "question",
      answerer: buzzer ? null : g.current,
      category,
      categories: [],
      q,
      stealing: false,
      attempts: [],
      hints: [null, null],
    });
    this.open(this.rules.timeLimit * 1000);
    this.changed();
  }

  /** Active questions for the active cell's letter, in `category` if given. */
  private pool(category: string | null) {
    const g = this.game;
    const letter = g.letters[g.active!];
    return BANK.filter((q) => q.isActive && q.letter === letter && (!category || q.category === category));
  }

  /**
   * A random question nobody in this room has seen, preferring one whose answer
   * hasn't come up either. Only once the whole pool has been asked does it fall
   * back to the question asked longest ago (or to null when `repeat` is false).
   */
  private draw(category: string | null, { except = "", repeat = true } = {}): Question | null {
    const pool = this.pool(category).filter((q) => q.id !== except);
    const fresh = pool.filter((q) => !this.asked.has(q.id));
    const unseen = fresh.filter((q) => !this.answersSeen.has(answerKey(q)));
    const list = unseen.length ? unseen : fresh;
    if (list.length) return list[randomInt(list.length)];
    if (!repeat || !pool.length) return null;
    return pool.reduce((a, b) => (this.asked.get(a.id)! <= this.asked.get(b.id)! ? a : b));
  }

  private remember(q: Question) {
    this.asked.set(q.id, ++this.asks);
    this.answersSeen.add(answerKey(q));
  }

  /** Start a buzz or answer window, halved on a fast cell. */
  private open(ms: number) {
    const g = this.game;
    if (g.active !== null && g.specials[g.active] === "fast") ms = fastMs(ms);
    g.deadline = Date.now() + ms;
    g.windowMs = ms;
    this.arm();
  }

  private arm() {
    this.clearTimer();
    this.timer = setTimeout(() => {
      if (this.game.phase === "buzz") this.resolve(null);
      else this.attempt("", "timeout");
    }, this.game.deadline - Date.now() + ANSWER_GRACE_MS);
  }

  /** Locked cells, unless they are the only ones left to pick. */
  private locks(): number[] {
    const g = this.game;
    return g.owners.some((o, i) => o === null && !g.locked.includes(i)) ? g.locked : [];
  }

  buzz(seat: Seat) {
    const g = this.game;
    if (this.stage !== "game" || g.phase !== "buzz" || Date.now() > g.deadline + ANSWER_GRACE_MS) return;
    Object.assign(g, { phase: "question", answerer: seat });
    this.open(BUZZ_ANSWER_S * 1000);
    this.changed();
  }

  answer(seat: Seat, text: string) {
    const g = this.game;
    if (this.stage !== "game" || g.phase !== "question" || seat !== g.answerer) return;
    const late = Date.now() > g.deadline + ANSWER_GRACE_MS;
    this.attempt(String(text ?? "").slice(0, MAX_ANSWER), late ? "timeout" : null);
  }

  power(seat: Seat, kind: PowerKind) {
    const g = this.game;
    if (this.stage !== "game" || !this.rules.powers || !POWER_KINDS.includes(kind)) return;
    if (g.phase !== "question" || seat !== g.answerer || !g.q || g.powers[seat][kind]) return;
    if (kind === "skip") {
      // Never a question already asked: the chosen category first, then any other for this letter.
      const opts = { except: g.q.id, repeat: false };
      const q = g.stealing ? null : (this.draw(g.category, opts) ?? this.draw(null, opts));
      if (!q) return;
      this.remember(q);
      Object.assign(g, { q, hints: [null, null] });
      this.open((this.rules.mode === "buzzer" ? BUZZ_ANSWER_S : this.rules.timeLimit) * 1000);
    } else if (kind === "time") {
      g.deadline += POWER_TIME_S * 1000;
      g.windowMs += POWER_TIME_S * 1000;
      this.arm();
    } else {
      g.hints[seat] = answerHint(g.q.answer);
    }
    g.powers[seat][kind] = true;
    this.changed();
  }

  private attempt(given: string, timeout: "timeout" | null) {
    const g = this.game;
    if (g.phase !== "question" || !g.q || g.answerer === null) return;
    this.clearTimer();
    const seat = g.answerer;
    // A stealer who sends nothing is passing up the chance.
    const kind: Attempt["kind"] = timeout ?? (g.stealing && !given.trim() ? "pass" : null);
    const ok = !kind && answerMatches(given, g.q.acceptedAnswers);
    g.attempts.push({ seat, ok, kind, given: kind ? "" : given });
    // Letting a steal run out isn't a wrong answer; a wrong steal is.
    if (ok) g.stats[seat].c++;
    else if (!g.stealing || !kind) g.stats[seat].w++;
    if (ok) return this.resolve(seat);
    if (this.rules.steal && this.rules.penalty !== "gift" && !g.stealing) {
      Object.assign(g, { stealing: true, answerer: 1 - seat });
      this.open(stealMs(this.rules.timeLimit));
      return this.changed();
    }
    this.resolve(null);
  }

  /** Settle the active cell: who gets it, what the special cell and penalty do, and who picks next. */
  private resolve(winner: Seat | null) {
    const g = this.game;
    const cell = g.active!;
    this.clearTimer();
    const first = g.attempts[0];
    const missed = first && !first.ok ? first.seat : null; // took the question on and got it wrong
    const gift = winner === null && missed !== null && this.rules.penalty === "gift";
    const owner = gift ? ((1 - missed!) as Seat) : winner;
    if (owner !== null) g.owners[cell] = owner;
    let lost: number | null = null;
    if (missed !== null && g.specials[cell] === "bomb") {
      const theirs = g.owners.flatMap((o, i) => (o === missed ? [i] : []));
      if (theirs.length) {
        lost = theirs[randomInt(theirs.length)];
        g.owners[lost] = null;
      }
    }
    const locked = owner === null && missed !== null && this.rules.penalty === "lock";
    const bonus = winner !== null && g.specials[cell] === "gold";
    const path = owner !== null ? findWinPath(g.owners, owner) : null;
    Object.assign(g, {
      phase: "result",
      answerer: null,
      stealing: false,
      result: { ok: winner !== null, owner, attempts: g.attempts, lost, bonus, locked, gift },
      winPath: path ?? [],
      winner: path ? owner : null,
    });
    const busy = g.attempts.length > 1 || lost !== null || bonus || locked || gift;
    this.timer = setTimeout(
      () => {
        if (path) {
          g.phase = "won";
          this.wins[owner as Seat]++;
        } else {
          g.phase = "pick";
          g.current = bonus ? winner! : ((1 - g.current) as Seat);
          g.turn++;
          g.active = null;
          g.locked = locked ? [cell] : [];
        }
        this.changed();
      },
      RESULT_MS + (busy ? RESULT_EXTRA_MS : 0),
    );
    this.changed();
  }

  view(you: Seat): RoomView {
    const g = this.game;
    const reveal = g.phase === "result" || g.phase === "won";
    const open = g.phase === "buzz" || g.phase === "question";
    const asking = g.phase === "question";
    const pv = (p: Player | null) => p && { name: p.name, connected: p.connections > 0 };
    return {
      code: this.code,
      you,
      stage: this.stage,
      players: [pv(this.players[0])!, pv(this.players[1])],
      rules: this.rules,
      size: g.size,
      letters: g.letters,
      specials: g.specials,
      owners: g.owners,
      locked: this.locks(),
      current: g.current,
      turn: g.turn,
      phase: g.phase,
      active: g.active,
      categories: g.phase === "category" ? g.categories : [],
      q:
        g.q && (open || reveal)
          ? { letter: g.q.letter, category: g.q.category, question: g.q.question, ...(reveal ? { answer: g.q.answer } : {}) }
          : null,
      answerer: asking ? g.answerer : null,
      stealing: asking && g.stealing,
      attempts: asking ? g.attempts : [],
      remainingMs: open ? Math.max(0, g.deadline - Date.now()) : 0,
      windowMs: open ? g.windowMs : 0,
      hint: asking ? g.hints[you] : null,
      powers: g.powers,
      canSkip: asking && g.answerer === you && !g.stealing && this.pool(null).some((q) => !this.asked.has(q.id)),
      result: g.result,
      winPath: g.winPath,
      winner: g.winner,
      stats: g.stats,
      round: this.round,
      wins: this.wins,
      sessionOver: g.phase === "won" && this.sessionOver,
      sessionWinner: this.sessionWinner,
    };
  }

  private clearTimer() {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  dispose() {
    this.clearTimer();
  }
}

const token = () => randomBytes(18).toString("base64url");
