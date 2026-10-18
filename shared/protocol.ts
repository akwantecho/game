import type { PowerKind, Rules, Seat, Special } from "./game";

// ── client → server ────────────────────────────────────────────────────────
export type ClientMsg =
  /** Log in with email and a 4-digit PIN; the first login for an email creates the account. */
  | { t: "login"; email: string; pin: string }
  /** Restore a saved login session. */
  | { t: "auth"; token: string }
  | { t: "logout" }
  | { t: "create"; name: string; rules?: Partial<Rules> }
  | { t: "join"; code: string; name: string }
  | { t: "resume"; code: string; token: string }
  | { t: "peek"; code: string }
  | { t: "rules"; rules: Partial<Rules> }
  | { t: "start" }
  | { t: "pick"; cell: number }
  | { t: "category"; name: string }
  | { t: "buzz" }
  | { t: "answer"; text: string }
  | { t: "power"; kind: PowerKind }
  | { t: "rematch" }
  | { t: "leave" };

// ── server → client ────────────────────────────────────────────────────────
/**
 * pick → [category] → [buzz] → question → result → pick … → won.
 * "category" only runs when the picker chooses the category; "buzz" only in buzzer mode.
 */
export type Phase = "pick" | "category" | "buzz" | "question" | "result" | "won";

export interface PublicQuestion {
  letter: string;
  category: string;
  question: string;
  /** Only sent once the turn's answer is in (phase "result"/"won"). */
  answer?: string;
}

export interface PlayerView {
  name: string;
  connected: boolean;
}

/** One try at the open question. "pass" is a stealer declining their chance. */
export interface Attempt {
  seat: Seat;
  ok: boolean;
  kind: "timeout" | "pass" | null;
  given: string;
}

export interface TurnResult {
  /** Someone answered correctly. */
  ok: boolean;
  /** Who holds the cell now: the right answer's author, or the opponent under the "gift" penalty. */
  owner: Seat | null;
  attempts: Attempt[];
  /** Cell the bomb took from the player who missed it. */
  lost: number | null;
  /** A gold cell was taken: its taker picks again. */
  bonus: boolean;
  /** The missed cell is locked for the next turn. */
  locked: boolean;
  /** The missed cell went to the opponent. */
  gift: boolean;
}

/** One phone's view of the room. Never carries the answer of an open question. */
export interface RoomView {
  code: string;
  you: Seat;
  stage: "lobby" | "game";
  players: [PlayerView, PlayerView | null];
  rules: Rules;
  /** Board side; the board has size × size cells. */
  size: number;
  letters: string[];
  specials: (Special | null)[];
  owners: (Seat | null)[];
  /** Cells that can't be picked this turn. */
  locked: number[];
  /** Whose turn it is to pick. */
  current: Seat;
  turn: number;
  phase: Phase;
  active: number | null;
  /** Category choices while phase is "category". */
  categories: string[];
  q: PublicQuestion | null;
  /** Who is answering in phase "question". */
  answerer: Seat | null;
  /** The answerer is trying to steal a question the other player missed. */
  stealing: boolean;
  /** Tries so far at the open question. */
  attempts: Attempt[];
  /** Time left on the open window (buzz or answer) when this view was sent. */
  remainingMs: number;
  /** Full length of that window, for the timer bar. */
  windowMs: number;
  /** The hint you asked for on this question, if any. */
  hint: { mask: string; letters: number } | null;
  /** Power-ups each seat has already used this match. */
  powers: [Record<PowerKind, boolean>, Record<PowerKind, boolean>];
  /** Whether a skip would find another question for this cell. */
  canSkip: boolean;
  result: TurnResult | null;
  winPath: number[];
  /** Who won the current round (completed a path), if any. */
  winner: Seat | null;
  stats: [{ c: number; w: number }, { c: number; w: number }];
  /** Best-of series: which round (1-based) and how many rounds each seat has won. */
  round: number;
  wins: [number, number];
  /** Set once phase is "won" and the series is decided. */
  sessionOver: boolean;
  /** The series champion on sessionOver, or null for a tie. */
  sessionWinner: Seat | null;
}

export type ErrorCode =
  | "bad_code"
  | "room_full"
  | "name_taken"
  | "bad_name"
  | "session_lost"
  | "login_required"
  | "bad_email"
  | "bad_pin_format"
  | "bad_pin"
  | "locked"
  | "too_many"
  | "auth_lost";

/** The logged-in account, sent after a login or a restored session. */
export interface AccountView {
  email: string;
  name: string;
  /** Questions this account has been asked so far: none of them comes back until the rest run out. */
  seen: number;
  total: number;
}

export type ServerMsg =
  | { t: "session"; code: string; token: string; seat: Seat }
  | { t: "state"; view: RoomView }
  | { t: "peek"; code: string; host: string | null }
  | { t: "account"; token: string; account: AccountView; created: boolean }
  | { t: "error"; code: ErrorCode; message: string };
