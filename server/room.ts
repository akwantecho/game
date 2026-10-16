import { randomBytes, randomInt } from "node:crypto";
import { CELLS, RESULT_MS, TIME_LIMITS, findWinPath, normalizeAnswer, type Seat } from "../shared/game";
import type { Phase, RoomView } from "../shared/protocol";
import { BANK, type Question } from "./questions";

/** Answers that arrive this long after the deadline still count (network latency). */
export const ANSWER_GRACE_MS = 400;
export const MAX_NAME = 20;
export const MAX_ANSWER = 60;

interface Player {
  name: string;
  token: string;
  connections: number;
}

interface Game {
  letters: string[];
  owners: (Seat | null)[];
  current: Seat;
  turn: number;
  phase: Phase;
  active: number | null;
  q: Question | null;
  deadline: number;
  result: { ok: boolean; kind: "timeout" | null; given: string } | null;
  used: string[];
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

function newGame(): Game {
  const letters = shuffle([...new Set(BANK.filter((q) => q.isActive).map((q) => q.letter))]).slice(0, CELLS);
  return {
    letters,
    owners: Array(CELLS).fill(null),
    current: 0,
    turn: 1,
    phase: "pick",
    active: null,
    q: null,
    deadline: 0,
    result: null,
    used: [],
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
  readonly timeLimit: number;
  stage: "lobby" | "game" = "lobby";
  game: Game = newGame();
  lastActive = Date.now();
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    readonly code: string,
    hostName: string,
    timeLimit: number,
    private onChange: (room: Room) => void,
  ) {
    this.players = [{ name: hostName, token: token(), connections: 0 }, null];
    this.timeLimit = (TIME_LIMITS as readonly number[]).includes(timeLimit) ? timeLimit : 20;
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

  start(seat: Seat) {
    if (seat !== 0 || this.stage !== "lobby" || !this.players[1]) return;
    this.stage = "game";
    this.game = newGame();
    this.changed();
  }

  rematch() {
    if (this.stage !== "game" || this.game.phase !== "won") return;
    this.clearTimer();
    this.game = newGame();
    this.changed();
  }

  pick(seat: Seat, cell: number) {
    const g = this.game;
    if (this.stage !== "game" || g.phase !== "pick" || seat !== g.current) return;
    if (!Number.isInteger(cell) || cell < 0 || cell >= CELLS || g.owners[cell] !== null) return;
    const pool = BANK.filter((q) => q.isActive && q.letter === g.letters[cell]);
    const fresh = pool.filter((q) => !g.used.includes(q.id));
    const list = fresh.length ? fresh : pool;
    const q = list[randomInt(list.length)];
    const ms = this.timeLimit * 1000;
    Object.assign(g, { phase: "question", active: cell, q, deadline: Date.now() + ms, used: g.used.concat(q.id) });
    this.clearTimer();
    this.timer = setTimeout(() => this.finish("", "timeout"), ms + ANSWER_GRACE_MS);
    this.changed();
  }

  answer(seat: Seat, text: string) {
    const g = this.game;
    if (this.stage !== "game" || g.phase !== "question" || seat !== g.current) return;
    const late = Date.now() > g.deadline + ANSWER_GRACE_MS;
    this.finish(String(text ?? "").slice(0, MAX_ANSWER), late ? "timeout" : null);
  }

  private finish(given: string, kind: "timeout" | null) {
    const g = this.game;
    if (g.phase !== "question" || !g.q || g.active === null) return;
    this.clearTimer();
    const ok = !kind && g.q.acceptedAnswers.some((a) => normalizeAnswer(a) === normalizeAnswer(given));
    if (ok) g.owners[g.active] = g.current;
    const st = g.stats[g.current];
    if (ok) st.c++;
    else st.w++;
    const path = ok ? findWinPath(g.owners, g.current) : null;
    g.phase = "result";
    g.result = { ok, kind, given: kind ? "" : given };
    g.winPath = path ?? [];
    g.winner = path ? g.current : null;
    this.timer = setTimeout(() => {
      if (path) g.phase = "won";
      else {
        g.phase = "pick";
        g.current = (1 - g.current) as Seat;
        g.turn++;
        g.active = null;
      }
      this.changed();
    }, RESULT_MS);
    this.changed();
  }

  view(you: Seat): RoomView {
    const g = this.game;
    const reveal = g.phase === "result" || g.phase === "won";
    const pv = (p: Player | null) => p && { name: p.name, connected: p.connections > 0 };
    return {
      code: this.code,
      you,
      stage: this.stage,
      players: [pv(this.players[0])!, pv(this.players[1])],
      timeLimit: this.timeLimit,
      letters: g.letters,
      owners: g.owners,
      current: g.current,
      turn: g.turn,
      phase: g.phase,
      active: g.active,
      q: g.q && { letter: g.q.letter, category: g.q.category, question: g.q.question, ...(reveal ? { answer: g.q.answer } : {}) },
      remainingMs: g.phase === "question" ? Math.max(0, g.deadline - Date.now()) : 0,
      result: g.result,
      winPath: g.winPath,
      winner: g.winner,
      stats: g.stats,
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
