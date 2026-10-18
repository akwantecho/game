import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { ClientMsg, RoomView, ServerMsg } from "../shared/protocol";
import { attachHub } from "../server/hub";
import { BANK } from "../server/questions";

let server: Server;
let hub: ReturnType<typeof attachHub>;
let url: string;

beforeAll(async () => {
  server = createServer();
  hub = attachHub(server);
  await new Promise<void>((r) => server.listen(0, r));
  url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/ws`;
});
afterAll(() => {
  hub.close();
  server.close();
});

/** A test phone: records every message and lets a test wait for a matching one. */
/** A test phone; with `email` it logs in (PIN 1234) before returning. */
async function phone(email?: string) {
  const ws = new WebSocket(url);
  const log: ServerMsg[] = [];
  let cursor = 0; // messages before this index have been consumed by a wait
  let wake = () => {};
  ws.on("message", (raw) => {
    log.push(JSON.parse(String(raw)) as ServerMsg);
    wake();
  });
  await new Promise((r) => ws.once("open", r));
  const next = <T extends ServerMsg>(pred: (m: ServerMsg) => boolean, timeout = 4000) =>
    new Promise<T>((res, rej) => {
      const t = setTimeout(() => rej(new Error("timed out waiting for message")), timeout);
      const scan = () => {
        for (; cursor < log.length; cursor++)
          if (pred(log[cursor])) {
            clearTimeout(t);
            wake = () => {};
            return res(log[cursor++] as T);
          }
      };
      wake = scan;
      scan();
    });
  const state = (pred: (v: RoomView) => boolean = () => true, timeout?: number) =>
    next<{ t: "state"; view: RoomView }>((m) => m.t === "state" && pred(m.view), timeout).then((m) => m.view);
  const send = (m: ClientMsg) => ws.send(JSON.stringify(m));
  if (email) {
    send({ t: "login", email, pin: "1234" });
    await next((m) => m.t === "account", 8000);
  }
  return { ws, log, next, state, send, close: () => ws.close() };
}

const answerFor = (view: RoomView) =>
  BANK.find((q) => q.question === view.q!.question)!.answer;

describe("online match", () => {
  it("rejects a wrong room code, then plays a full game to a win", async () => {
    const host = await phone("host1@test.co");
    const guest = await phone("guest1@test.co");

    host.send({ t: "create", name: "صلاح", rules: { timeLimit: 10 } });
    const session = await host.next<{ t: "session"; code: string }>((m) => m.t === "session");
    const lobby = await host.state();
    expect(lobby.stage).toBe("lobby");
    expect(lobby.rules.timeLimit).toBe(10);

    guest.send({ t: "join", code: "ZZZZZ", name: "سعد" });
    const err = await guest.next<{ t: "error"; code: string }>((m) => m.t === "error");
    expect(err.code).toBe("bad_code");

    guest.send({ t: "join", code: session.code.toLowerCase(), name: "صلاح" });
    expect((await guest.next<{ t: "error"; code: string }>((m) => m.t === "error")).code).toBe("name_taken");

    guest.send({ t: "join", code: session.code, name: "سعد" });
    await host.state((v) => v.players[1]?.connected === true);

    // only the host can start
    guest.send({ t: "start" });
    host.send({ t: "start" });
    const g0 = await guest.state((v) => v.stage === "game");
    expect(g0.current).toBe(0);
    expect(g0.letters).toHaveLength(25);

    // the guest can't pick on the host's turn
    guest.send({ t: "pick", cell: 0 });

    // Host takes row 2 (cells 10..14) with right answers; guest answers wrong in between.
    const guestCells = [0, 1, 2, 3, 4];
    for (let k = 0; k < 5; k++) {
      host.send({ t: "pick", cell: 10 + k });
      const hq = await host.state((v) => v.phase === "question");
      const gq = await guest.state((v) => v.phase === "question");
      expect(hq.q!.answer).toBeUndefined(); // answers never leave the server early
      expect(gq.q!.answer).toBeUndefined();
      expect(hq.active).toBe(10 + k);
      guest.send({ t: "answer", text: "not my turn" }); // ignored
      host.send({ t: "answer", text: answerFor(hq) });
      const res = await guest.state((v) => v.phase === "result" && v.current === 0);
      expect(res.result!.ok).toBe(true);
      expect(res.q!.answer).toBeTruthy();
      if (k === 4) break;
      await guest.state((v) => v.phase === "pick" && v.current === 1, 4000);
      guest.send({ t: "pick", cell: guestCells[k] });
      await guest.state((v) => v.phase === "question");
      guest.send({ t: "answer", text: "خطأ" });
      expect((await host.state((v) => v.phase === "result" && v.current === 1)).result!.ok).toBe(false);
      await host.state((v) => v.phase === "pick" && v.current === 0, 4000);
    }
    const won = await guest.state((v) => v.phase === "won", 4000);
    expect(won.winner).toBe(0);
    expect(won.winPath.sort()).toEqual([10, 11, 12, 13, 14]);
    expect(won.stats).toEqual([{ c: 5, w: 0 }, { c: 0, w: 4 }]);

    guest.send({ t: "rematch" });
    const again = await host.state((v) => v.phase === "pick" && v.turn === 1);
    expect(again.owners.every((o) => o === null)).toBe(true);

    host.close();
    guest.close();
  }, 30_000);

  it("times out an unanswered question and resumes a dropped phone", async () => {
    const host = await phone("host2@test.co");
    host.send({ t: "create", name: "أ", rules: { timeLimit: 10 } });
    const s = await host.next<{ t: "session"; code: string; token: string }>((m) => m.t === "session");
    const guest = await phone("guest2@test.co");
    guest.send({ t: "join", code: s.code, name: "ب" });
    const gs = await guest.next<{ t: "session"; code: string; token: string }>((m) => m.t === "session");
    host.send({ t: "start" });
    await host.state((v) => v.stage === "game");

    // guest drops and comes back with its token
    guest.close();
    await host.state((v) => v.players[1]?.connected === false);
    const back = await phone();
    back.send({ t: "resume", code: gs.code, token: gs.token });
    const resumed = await back.state();
    expect(resumed.you).toBe(1);
    expect(resumed.stage).toBe("game");

    // a bad token doesn't get a seat
    const intruder = await phone();
    intruder.send({ t: "resume", code: gs.code, token: "nope" });
    expect((await intruder.next<{ t: "error"; code: string }>((m) => m.t === "error")).code).toBe("session_lost");

    host.send({ t: "pick", cell: 7 });
    const q = await back.state((v) => v.phase === "question");
    expect(q.remainingMs).toBeGreaterThan(9000);
    const res = await back.state((v) => v.phase === "result", 12_000);
    expect(res.result).toMatchObject({ ok: false, owner: null, attempts: [{ seat: 0, ok: false, kind: "timeout", given: "" }] });

    // host leaving closes the room for the guest
    host.send({ t: "leave" });
    expect((await back.next<{ t: "error"; code: string }>((m) => m.t === "error")).code).toBe("session_lost");
    expect(hub.rooms.has(s.code)).toBe(false);
    host.close();
    back.close();
    intruder.close();
  }, 30_000);
  it("needs a login to play, and a saved token restores it on a new connection", async () => {
    type Err = { t: "error"; code: string; message: string };
    type Acc = { t: "account"; token: string; created: boolean; account: { email: string; seen: number; total: number } };
    const p = await phone();
    p.send({ t: "create", name: "أ" });
    expect((await p.next<Err>((m) => m.t === "error")).code).toBe("login_required");
    p.send({ t: "login", email: "new@test.co", pin: "12" });
    expect((await p.next<Err>((m) => m.t === "error")).code).toBe("bad_pin_format");
    p.send({ t: "login", email: "New@Test.co", pin: "4321" });
    const acc = await p.next<Acc>((m) => m.t === "account", 8000);
    expect(acc).toMatchObject({ created: true, account: { email: "new@test.co", seen: 0 } });
    expect(acc.account.total).toBeGreaterThan(900);

    const later = await phone();
    later.send({ t: "auth", token: acc.token });
    expect(await later.next<Acc>((m) => m.t === "account")).toMatchObject({ created: false, account: { email: "new@test.co" } });
    later.send({ t: "login", email: "new@test.co", pin: "0000" });
    const wrong = await later.next<Err>((m) => m.t === "error", 8000);
    expect(wrong.code).toBe("bad_pin");
    expect(wrong.message).toContain("بقيت لك 4");

    later.send({ t: "logout" });
    later.send({ t: "create", name: "أ" });
    expect((await later.next<Err>((m) => m.t === "error")).code).toBe("login_required");
    // Logging out ends that session everywhere it was used.
    later.send({ t: "auth", token: acc.token });
    expect((await later.next<Err>((m) => m.t === "error")).code).toBe("auth_lost");
    p.close();
    later.close();
  }, 30_000);
});
