import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

/** Wrong PINs in a row before an account is locked for LOCK_MS. A 4-digit PIN has only 10,000
 * values, so without this anyone could try them all. */
export const MAX_FAILURES = 5;
export const LOCK_MS = 15 * 60 * 1000;
/** Sessions unused for this long are dropped. */
export const SESSION_MAX_IDLE_MS = 180 * 24 * 60 * 60 * 1000;

export interface Account {
  id: number;
  email: string;
  name: string;
}

export type LoginResult =
  | { ok: true; account: Account; token: string; created: boolean }
  | { ok: false; code: "bad_email" | "bad_pin_format" | "bad_pin" | "locked"; left?: number; minutes?: number };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const cleanEmail = (s: unknown) => (typeof s === "string" ? s.trim().toLowerCase().slice(0, 254) : "");
export const validPin = (s: unknown): s is string => typeof s === "string" && /^[0-9]{4}$/.test(s);

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

function hashPin(pin: string, salt = randomBytes(16)): Promise<string> {
  return new Promise((res, rej) =>
    scrypt(pin, salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (err, key) =>
      err ? rej(err) : res(`${salt.toString("hex")}:${key.toString("hex")}`),
    ),
  );
}

async function pinMatches(pin: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(":");
  const again = (await hashPin(pin, Buffer.from(salt, "hex"))).split(":")[1];
  return timingSafeEqual(Buffer.from(again, "hex"), Buffer.from(hash, "hex"));
}

/**
 * Accounts (email + 4-digit PIN), login sessions, and which questions each account has been asked.
 * One SQLite file; `:memory:` for tests.
 */
export class Store {
  private db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS accounts (
        id INTEGER PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        pin TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        failures INTEGER NOT NULL DEFAULT 0,
        locked_until INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        last_seen INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS asked (
        account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        question_id TEXT NOT NULL,
        asked_at INTEGER NOT NULL,
        PRIMARY KEY (account_id, question_id)
      );
    `);
  }

  /** Log in, or create the account the first time an email is used: that first PIN becomes its PIN. */
  async login(emailIn: unknown, pin: unknown, now = Date.now()): Promise<LoginResult> {
    const email = cleanEmail(emailIn);
    if (!EMAIL.test(email)) return { ok: false, code: "bad_email" };
    if (!validPin(pin)) return { ok: false, code: "bad_pin_format" };
    const row = this.db.prepare("SELECT id, email, name, pin, failures, locked_until FROM accounts WHERE email = ?").get(email) as
      | { id: number; email: string; name: string; pin: string; failures: number; locked_until: number }
      | undefined;
    if (!row) {
      const hashed = await hashPin(pin);
      // Two first logins for the same email can race; the loser just logs in normally.
      const ins = this.db.prepare("INSERT OR IGNORE INTO accounts (email, pin, created_at) VALUES (?, ?, ?)").run(email, hashed, now);
      if (ins.changes === 0) return this.login(email, pin, now);
      const account = { id: Number(ins.lastInsertRowid), email, name: "" };
      return { ok: true, account, token: this.openSession(account.id, now), created: true };
    }
    const lockedFor = (until: number) => ({ ok: false as const, code: "locked" as const, minutes: Math.ceil((until - now) / 60_000) });
    if (row.locked_until > now) return lockedFor(row.locked_until);
    // Count the attempt before the slow hash check: the check is async, so parallel guesses
    // would otherwise all read the same failure count and slip under the limit together.
    this.db.prepare("UPDATE accounts SET failures = failures + 1 WHERE id = ?").run(row.id);
    const { failures } = this.db.prepare("SELECT failures FROM accounts WHERE id = ?").get(row.id) as { failures: number };
    const lock = () => {
      this.db.prepare("UPDATE accounts SET failures = 0, locked_until = ? WHERE id = ?").run(now + LOCK_MS, row.id);
      return lockedFor(now + LOCK_MS);
    };
    if (failures > MAX_FAILURES) return lock();
    if (!(await pinMatches(pin, row.pin))) {
      return failures >= MAX_FAILURES ? lock() : { ok: false, code: "bad_pin", left: MAX_FAILURES - failures };
    }
    this.db.prepare("UPDATE accounts SET failures = 0, locked_until = 0 WHERE id = ?").run(row.id);
    return { ok: true, account: { id: row.id, email: row.email, name: row.name }, token: this.openSession(row.id, now), created: false };
  }

  /** The account a saved session token belongs to, refreshing its last use. */
  resume(token: unknown, now = Date.now()): Account | null {
    if (typeof token !== "string" || token.length < 20) return null;
    const h = sha256(token);
    const row = this.db
      .prepare("SELECT a.id, a.email, a.name, s.last_seen FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = ?")
      .get(h) as { id: number; email: string; name: string; last_seen: number } | undefined;
    if (!row) return null;
    if (now - row.last_seen > SESSION_MAX_IDLE_MS) {
      this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(h);
      return null;
    }
    this.db.prepare("UPDATE sessions SET last_seen = ? WHERE token_hash = ?").run(now, h);
    return { id: row.id, email: row.email, name: row.name };
  }

  logout(token: unknown) {
    if (typeof token === "string") this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
  }

  setName(accountId: number, name: string) {
    this.db.prepare("UPDATE accounts SET name = ? WHERE id = ?").run(name, accountId);
  }

  /** Every question these accounts have been asked, with the latest time any of them saw it. */
  seen(accountIds: number[]): Map<string, number> {
    const out = new Map<string, number>();
    if (!accountIds.length) return out;
    const rows = this.db
      .prepare(`SELECT question_id, MAX(asked_at) AS at FROM asked WHERE account_id IN (${accountIds.map(() => "?").join(",")}) GROUP BY question_id`)
      .all(...accountIds) as { question_id: string; at: number }[];
    for (const r of rows) out.set(r.question_id, r.at);
    return out;
  }

  seenCount(accountId: number): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM asked WHERE account_id = ?").get(accountId) as { n: number }).n;
  }

  record(accountIds: number[], questionId: string, at = Date.now()) {
    const st = this.db.prepare(
      "INSERT INTO asked (account_id, question_id, asked_at) VALUES (?, ?, ?) ON CONFLICT (account_id, question_id) DO UPDATE SET asked_at = excluded.asked_at",
    );
    for (const id of accountIds) st.run(id, questionId, at);
  }

  private openSession(accountId: number, now: number): string {
    const token = randomBytes(32).toString("base64url");
    this.db.prepare("INSERT INTO sessions (token_hash, account_id, last_seen) VALUES (?, ?, ?)").run(sha256(token), accountId, now);
    return token;
  }

  close() {
    this.db.close();
  }
}

/** What a room needs from the store: read and write the players' question history. */
export interface History {
  seen(accountIds: number[]): Map<string, number>;
  record(accountIds: number[], questionId: string, at?: number): void;
}
