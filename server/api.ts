import type { IncomingMessage, ServerResponse } from "node:http";
import { ERRORS, accountView, loginFailure } from "./messages";
import { BANK } from "./questions";
import type { Store } from "./store";

// JSON over HTTPS for the iPhone app, which plays locally and only needs the server for
// accounts and question history. Same accounts and rules as the web app's WebSocket login.
//
//   POST /api/login    {email, pin}  → {token, created, account}
//   GET  /api/account                → {account}
//   POST /api/logout                 → 204
//   GET  /api/history                → {ids}       every question this account was asked
//   POST /api/history  {ids}         → {account}   record questions asked in a local match
//
// Everything but login takes `Authorization: Bearer <token>`.

const KNOWN = new Set(BANK.filter((q) => q.isActive).map((q) => q.id));
const MAX_BODY = 32 * 1024;
/** Questions one history upload may record: a long offline session, not the whole bank. */
const MAX_RECORD = 300;
/** Login attempts per client address per window, on top of the per-account lock. */
const IP_LOGINS = 10;
const IP_WINDOW_MS = 10 * 60 * 1000;
const attempts = new Map<string, number[]>();

/** The caller's address. Behind nginx on this host, the last X-Forwarded-For hop is the one nginx saw. */
function clientIp(req: IncomingMessage): string {
  const remote = req.socket.remoteAddress ?? "";
  const fwd = req.headers["x-forwarded-for"];
  const local = remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
  return local && typeof fwd === "string" ? fwd.split(",").pop()!.trim() : remote;
}

function throttled(ip: string, now = Date.now()): boolean {
  if (attempts.size > 5000) {
    for (const [k, ts] of attempts) if (ts.every((t) => now - t >= IP_WINDOW_MS)) attempts.delete(k);
  }
  const recent = (attempts.get(ip) ?? []).filter((t) => now - t < IP_WINDOW_MS);
  if (recent.length >= IP_LOGINS) {
    attempts.set(ip, recent);
    return true;
  }
  recent.push(now);
  attempts.set(ip, recent);
  return false;
}

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => {
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
        resolve(v && typeof v === "object" ? v : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function reply(res: ServerResponse, status: number, data?: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(data === undefined ? "" : JSON.stringify(data));
}

export async function handleApi(req: IncomingMessage, res: ServerResponse, store: Store): Promise<void> {
  const path = new URL(req.url ?? "/", "http://x").pathname;
  try {
    if (path === "/api/login" && req.method === "POST") {
      if (throttled(clientIp(req))) return reply(res, 429, { code: "too_many", message: ERRORS.too_many });
      const body = await readJson(req);
      const r = await store.login(body.email, body.pin);
      if (r.ok) return reply(res, 200, { token: r.token, created: r.created, account: accountView(store, r.account) });
      return reply(res, r.code === "locked" ? 423 : r.code === "bad_pin" ? 401 : 400, loginFailure(r));
    }

    const auth = req.headers.authorization;
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
    const account = store.resume(token);
    if (!account) return reply(res, 401, { code: "auth_lost", message: ERRORS.auth_lost });

    if (path === "/api/account" && req.method === "GET") return reply(res, 200, { account: accountView(store, account) });
    if (path === "/api/logout" && req.method === "POST") {
      store.logout(token);
      return reply(res, 204);
    }
    if (path === "/api/history" && req.method === "GET") return reply(res, 200, { ids: [...store.seen([account.id]).keys()] });
    if (path === "/api/history" && req.method === "POST") {
      const body = await readJson(req);
      const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === "string" && KNOWN.has(id)) : [];
      const now = Date.now();
      for (const id of [...new Set(ids)].slice(0, MAX_RECORD)) store.record([account.id], id, now);
      return reply(res, 200, { account: accountView(store, account) });
    }
    return reply(res, 404, { code: "not_found" });
  } catch {
    if (!res.headersSent) reply(res, 400, { code: "bad_request" });
  }
}
