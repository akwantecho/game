import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMsg, RoomView, ServerMsg } from "../shared/protocol";

const SESSION_KEY = "lettersWar.session";

interface Session {
  code: string;
  token: string;
}

const store = {
  get(): Session | null {
    try {
      return JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null");
    } catch {
      return null;
    }
  },
  set(s: Session | null) {
    try {
      if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
      else localStorage.removeItem(SESSION_KEY);
    } catch {
      /* storage blocked: the session just won't survive a reload */
    }
  },
};

export interface Net {
  online: boolean;
  /** True until the first connection settles whether a saved session can resume. */
  resuming: boolean;
  view: RoomView | null;
  /** Local time (performance.now) at which the open buzz or answer window runs out. */
  deadline: number;
  error: { code: string; message: string } | null;
  peekHost: string | null;
  send: (m: ClientMsg) => void;
  clearError: () => void;
  leave: () => void;
}

/**
 * Keeps one WebSocket to the room server, reconnecting with backoff and
 * resuming the saved seat after a reload or a dropped connection.
 */
export function useRoomServer(): Net {
  const ws = useRef<WebSocket | null>(null);
  const [online, setOnline] = useState(false);
  const resumingRef = useRef(store.get() !== null);
  const [resuming, setResuming] = useState(resumingRef.current);
  const markResumed = () => {
    resumingRef.current = false;
    setResuming(false);
  };
  const [view, setView] = useState<RoomView | null>(null);
  const [deadline, setDeadline] = useState(0);
  const [error, setError] = useState<Net["error"]>(null);
  const [peekHost, setPeekHost] = useState<string | null>(null);
  const queue = useRef<ClientMsg[]>([]);

  useEffect(() => {
    let attempt = 0;
    let stopped = false;
    let retry: ReturnType<typeof setTimeout>;

    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const sock = new WebSocket(`${proto}://${location.host}/ws`);
      ws.current = sock;
      sock.onopen = () => {
        attempt = 0;
        setOnline(true);
        const s = store.get();
        if (s) sock.send(JSON.stringify({ t: "resume", ...s } satisfies ClientMsg));
        else markResumed();
        for (const m of queue.current.splice(0)) sock.send(JSON.stringify(m));
      };
      sock.onmessage = (e) => {
        const m: ServerMsg = JSON.parse(e.data);
        if (m.t === "session") {
          store.set({ code: m.code, token: m.token });
          setError(null);
        } else if (m.t === "state") {
          setView(m.view);
          setDeadline(m.view.remainingMs > 0 ? performance.now() + m.view.remainingMs : 0);
          markResumed();
        } else if (m.t === "peek") {
          setPeekHost(m.host);
        } else if (m.t === "error") {
          if (m.code === "session_lost") {
            store.set(null);
            setView(null);
            // A stale saved session on load isn't worth an error message.
            if (!resumingRef.current) setError({ code: m.code, message: m.message });
            markResumed();
          } else setError({ code: m.code, message: m.message });
        }
      };
      sock.onclose = () => {
        setOnline(false);
        if (ws.current === sock) ws.current = null;
        if (!stopped) retry = setTimeout(connect, Math.min(8000, 500 * 2 ** attempt++));
      };
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      ws.current?.close();
    };
  }, []);

  const send = useCallback((m: ClientMsg) => {
    const sock = ws.current;
    if (sock && sock.readyState === WebSocket.OPEN) sock.send(JSON.stringify(m));
    else if (m.t === "create" || m.t === "join" || m.t === "peek") queue.current.push(m);
  }, []);

  const leave = useCallback(() => {
    send({ t: "leave" });
    store.set(null);
    setView(null);
  }, [send]);

  return { online, resuming, view, deadline, error, peekHost, send, clearError: () => setError(null), leave };
}
