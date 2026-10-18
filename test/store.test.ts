import { describe, expect, it } from "vitest";
import { LOCK_MS, MAX_FAILURES, SESSION_MAX_IDLE_MS, Store } from "../server/store";

const fresh = () => new Store(":memory:");

describe("login", () => {
  it("creates the account on first use, then only accepts its PIN", async () => {
    const s = fresh();
    const first = await s.login("  Salah@Example.com ", "1234");
    expect(first).toMatchObject({ ok: true, created: true, account: { email: "salah@example.com" } });
    expect(await s.login("salah@example.com", "1234")).toMatchObject({ ok: true, created: false });
    expect(await s.login("salah@example.com", "4321")).toEqual({ ok: false, code: "bad_pin", left: MAX_FAILURES - 1 });
  });

  it("rejects malformed emails and PINs before touching the database", async () => {
    const s = fresh();
    expect(await s.login("not-an-email", "1234")).toEqual({ ok: false, code: "bad_email" });
    for (const pin of ["123", "12345", "abcd", "١٢٣٤", 1234]) expect(await s.login("a@b.co", pin)).toEqual({ ok: false, code: "bad_pin_format" });
  });

  it("locks the account after repeated wrong PINs, then lets the right one in once the lock ends", async () => {
    const s = fresh();
    await s.login("a@b.co", "1111", 0);
    for (let k = 1; k < MAX_FAILURES; k++) expect(await s.login("a@b.co", "0000", 0)).toMatchObject({ code: "bad_pin", left: MAX_FAILURES - k });
    expect(await s.login("a@b.co", "0000", 0)).toMatchObject({ code: "locked" });
    expect(await s.login("a@b.co", "1111", 1000)).toMatchObject({ code: "locked" }); // even the right PIN
    expect(await s.login("a@b.co", "1111", LOCK_MS + 1)).toMatchObject({ ok: true });
  });

  it("can't be raced: parallel guesses still get at most the allowed number of checks", async () => {
    const s = fresh();
    await s.login("a@b.co", "9999", 0);
    const pins = Array.from({ length: 40 }, (_, i) => String(1000 + i));
    const results = await Promise.all(pins.map((p) => s.login("a@b.co", p, 0)));
    expect(results.filter((r) => !r.ok && r.code === "bad_pin")).toHaveLength(MAX_FAILURES - 1);
    expect(results.every((r) => !r.ok)).toBe(true);
    expect(await s.login("a@b.co", "9999", 0)).toMatchObject({ code: "locked" });
  });
});

describe("sessions", () => {
  it("resumes from the token until logout or a long idle", async () => {
    const s = fresh();
    const res = await s.login("a@b.co", "1234", 0);
    if (!res.ok) throw new Error("login failed");
    expect(s.resume(res.token, 10)).toMatchObject({ email: "a@b.co" });
    expect(s.resume("x".repeat(43))).toBeNull();
    s.logout(res.token);
    expect(s.resume(res.token)).toBeNull();

    const again = await s.login("a@b.co", "1234", 0);
    if (!again.ok) throw new Error("login failed");
    expect(s.resume(again.token, SESSION_MAX_IDLE_MS + 1)).toBeNull();
  });
});

describe("question history", () => {
  it("returns the union of the accounts' histories with the latest time", async () => {
    const s = fresh();
    const a = await s.login("a@b.co", "1111");
    const b = await s.login("b@b.co", "2222");
    if (!a.ok || !b.ok) throw new Error("login failed");
    s.record([a.account.id], "q1", 100);
    s.record([a.account.id, b.account.id], "q2", 200);
    s.record([b.account.id], "q1", 300);
    expect(s.seen([a.account.id])).toEqual(new Map([["q1", 100], ["q2", 200]]));
    expect(s.seen([a.account.id, b.account.id])).toEqual(new Map([["q1", 300], ["q2", 200]]));
    expect(s.seenCount(b.account.id)).toBe(2);
    expect(s.seen([])).toEqual(new Map());
  });
});
