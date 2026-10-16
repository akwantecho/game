import type { Seat } from "./game";

// ── client → server ────────────────────────────────────────────────────────
export type ClientMsg =
  | { t: "create"; name: string; timeLimit: number }
  | { t: "join"; code: string; name: string }
  | { t: "resume"; code: string; token: string }
  | { t: "peek"; code: string }
  | { t: "start" }
  | { t: "pick"; cell: number }
  | { t: "answer"; text: string }
  | { t: "rematch" }
  | { t: "leave" };

// ── server → client ────────────────────────────────────────────────────────
export type Phase = "pick" | "question" | "result" | "won";

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

/** One phone's view of the room. Never carries the answer of an open question. */
export interface RoomView {
  code: string;
  you: Seat;
  stage: "lobby" | "game";
  players: [PlayerView, PlayerView | null];
  timeLimit: number;
  letters: string[];
  owners: (Seat | null)[];
  current: Seat;
  turn: number;
  phase: Phase;
  active: number | null;
  q: PublicQuestion | null;
  /** Time left on the open question when this view was sent. */
  remainingMs: number;
  result: { ok: boolean; kind: "timeout" | null; given: string } | null;
  winPath: number[];
  winner: Seat | null;
  stats: [{ c: number; w: number }, { c: number; w: number }];
}

export type ErrorCode = "bad_code" | "room_full" | "name_taken" | "bad_name" | "session_lost";

export type ServerMsg =
  | { t: "session"; code: string; token: string; seat: Seat }
  | { t: "state"; view: RoomView }
  | { t: "peek"; code: string; host: string | null }
  | { t: "error"; code: ErrorCode; message: string };
