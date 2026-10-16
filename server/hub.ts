import { randomInt } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { CODE_ALPHABET, CODE_LENGTH, type Seat } from "../shared/game";
import type { ClientMsg, ErrorCode, ServerMsg } from "../shared/protocol";
import { Room, cleanName } from "./room";

/** Rooms nobody is connected to are dropped after this long. */
export const IDLE_ROOM_MS = 15 * 60 * 1000;

const ERRORS: Record<ErrorCode, string> = {
  bad_code: "الرمز غير صحيح. تأكد منه وأعد المحاولة.",
  room_full: "هذه الغرفة ممتلئة.",
  name_taken: "اختر اسماً مختلفاً عن اسم صاحب الغرفة.",
  bad_name: "اكتب اسمك أولاً.",
  session_lost: "انتهت الغرفة. أنشئ غرفة جديدة أو انضم إلى أخرى.",
};

interface Conn {
  room?: Room;
  seat?: Seat;
}

export function attachHub(server: Server, path = "/ws") {
  const rooms = new Map<string, Room>();
  const sockets = new Map<WebSocket, Conn>();
  const wss = new WebSocketServer({ server, path, maxPayload: 4 * 1024 });

  const send = (ws: WebSocket, msg: ServerMsg) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };
  const fail = (ws: WebSocket, code: ErrorCode) => send(ws, { t: "error", code, message: ERRORS[code] });

  const broadcast = (room: Room) => {
    for (const [ws, c] of sockets) if (c.room === room && c.seat !== undefined) send(ws, { t: "state", view: room.view(c.seat) });
  };

  const newCode = () => {
    let code: string;
    do code = Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
    while (rooms.has(code));
    return code;
  };

  const bind = (ws: WebSocket, c: Conn, room: Room, seat: Seat, tok: string) => {
    if (c.room && c.seat !== undefined) c.room.setConnected(c.seat, -1);
    c.room = room;
    c.seat = seat;
    send(ws, { t: "session", code: room.code, token: tok, seat });
    room.setConnected(seat, 1); // broadcasts the state
  };

  const close = (room: Room, except?: WebSocket) => {
    room.dispose();
    rooms.delete(room.code);
    for (const [ws, c] of sockets)
      if (c.room === room) {
        c.room = c.seat = undefined;
        if (ws !== except) fail(ws, "session_lost");
      }
  };

  const handle = (ws: WebSocket, c: Conn, m: ClientMsg) => {
    const { room, seat } = c;
    switch (m.t) {
      case "create": {
        const name = cleanName(m.name);
        if (!name) return fail(ws, "bad_name");
        if (room && seat !== undefined) room.setConnected(seat, -1);
        const r = new Room(newCode(), name, m.rules, broadcast);
        rooms.set(r.code, r);
        return bind(ws, c, r, 0, r.players[0].token);
      }
      case "join": {
        const name = cleanName(m.name);
        if (!name) return fail(ws, "bad_name");
        const r = rooms.get(String(m.code ?? "").trim().toUpperCase());
        if (!r) return fail(ws, "bad_code");
        const res = r.join(name);
        if (typeof res === "string") return fail(ws, res);
        return bind(ws, c, r, res.seat, res.token);
      }
      case "resume": {
        const r = rooms.get(String(m.code ?? "").toUpperCase());
        const s = r?.seatFor(String(m.token ?? ""));
        if (!r || s == null) return fail(ws, "session_lost");
        return bind(ws, c, r, s, String(m.token));
      }
      case "peek": {
        const r = rooms.get(String(m.code ?? "").trim().toUpperCase());
        return send(ws, { t: "peek", code: String(m.code), host: r && !r.players[1] ? r.players[0].name : null });
      }
    }
    if (!room || seat === undefined) return fail(ws, "session_lost");
    switch (m.t) {
      case "rules":
        return room.setRules(seat, m.rules);
      case "start":
        return room.start(seat);
      case "pick":
        return room.pick(seat, Number(m.cell));
      case "category":
        return room.chooseCategory(seat, String(m.name ?? ""));
      case "buzz":
        return room.buzz(seat);
      case "answer":
        return room.answer(seat, String(m.text ?? ""));
      case "power":
        return room.power(seat, m.kind);
      case "rematch":
        return room.rematch();
      case "leave":
        c.room = c.seat = undefined;
        if (room.leave(seat)) return close(room, ws);
        // The guest left the lobby: any other tab still holding that seat loses it too.
        for (const [other, oc] of sockets)
          if (oc.room === room && oc.seat === seat) {
            oc.room = oc.seat = undefined;
            fail(other, "session_lost");
          }
        return;
    }
  };

  wss.on("connection", (ws: WebSocket, _req: IncomingMessage) => {
    const c: Conn = {};
    sockets.set(ws, c);
    ws.on("message", (raw) => {
      let m: ClientMsg;
      try {
        m = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (m && typeof m === "object" && typeof m.t === "string") handle(ws, c, m);
    });
    ws.on("close", () => {
      sockets.delete(ws);
      if (c.room && c.seat !== undefined) c.room.setConnected(c.seat, -1);
    });
  });

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const r of rooms.values()) {
      const online = r.players.some((p) => p && p.connections > 0);
      if (!online && now - r.lastActive > IDLE_ROOM_MS) close(r);
    }
  }, 60_000);
  sweep.unref();

  return { wss, rooms, close: () => (clearInterval(sweep), wss.close()) };
}
