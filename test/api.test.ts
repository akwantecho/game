import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handleApi } from "../server/api";
import { BANK } from "../server/questions";
import { Store } from "../server/store";

let server: Server;
let base: string;

beforeAll(async () => {
  const store = new Store(":memory:");
  server = createServer((req, res) => void handleApi(req, res, store));
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

const call = async (path: string, init: { method?: string; token?: string; body?: unknown } = {}) => {
  const res = await fetch(base + path, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: { "content-type": "application/json", ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
};

describe("app API", () => {
  it("logs in, syncs question history, and logs out", async () => {
    const first = await call("/api/login", { body: { email: "App@Test.co", pin: "2468" } });
    expect(first.status).toBe(200);
    expect(first.json).toMatchObject({ created: true, account: { email: "app@test.co", seen: 0 } });
    const token: string = first.json.token;

    expect((await call("/api/history", { token })).json).toEqual({ ids: [] });
    const ids = BANK.slice(0, 3).map((q) => q.id);
    const rec = await call("/api/history", { token, body: { ids: [...ids, ids[0], "q_not_a_question", 7] } });
    expect(rec.json.account.seen).toBe(3); // duplicates and unknown ids ignored
    expect((await call("/api/history", { token })).json.ids.sort()).toEqual([...ids].sort());
    expect((await call("/api/account", { token })).json.account.seen).toBe(3);

    expect((await call("/api/logout", { method: "POST", token })).status).toBe(204);
    expect((await call("/api/account", { token })).status).toBe(401);
  });

  it("explains a wrong PIN and refuses requests without a session", async () => {
    await call("/api/login", { body: { email: "pin@test.co", pin: "1111" } });
    const wrong = await call("/api/login", { body: { email: "pin@test.co", pin: "2222" } });
    expect(wrong.status).toBe(401);
    expect(wrong.json.code).toBe("bad_pin");
    expect(wrong.json.message).toContain("بقيت لك 4");
    expect((await call("/api/login", { body: { email: "pin@test.co", pin: "12" } })).json.code).toBe("bad_pin_format");
    expect((await call("/api/history")).status).toBe(401);
    expect((await call("/api/history", { token: "nope" })).json.code).toBe("auth_lost");
  });
});
