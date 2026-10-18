import { useCallback, useEffect, useRef, useState } from "react";
import type { AccountView, ClientMsg, RoomView, ServerMsg } from "../shared/protocol";

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

const AUTH_KEY = "lettersWar.auth";
const auth = {
  get(): string | null {
    try {
      return localStorage.getItem(AUTH_KEY);
    } catch {
      return null;
    }
  },
  set(token: string | null) {
    try {
      if (token) localStorage.setItem(AUTH_KEY, token);
      else localStorage.removeItem(AUTH_KEY);
    } catch {
      /* storage blocked: the login just won't survive a reload */
    }
  },
};

export interface Net {
  online: boolean;
  /** The logged-in account, or null. */
  account: AccountView | null;
  /** The account was created by this login (first time with this email). */
  created: boolean;
  /** True until a saved login has been checked with the server. */
  checkingAuth: boolean;
  login: (email: string, pin: string) => void;
  logout: () => void;
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
  const [account, setAccount] = useState<AccountView | null>(null);
  const [created, setCreated] = useState(false);
  const checkingRef = useRef(auth.get() !== null);
  const [checkingAuth, setCheckingAuth] = useState(checkingRef.current);
  const authChecked = () => {
    checkingRef.current = false;
    setCheckingAuth(false);
  };
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
        // Every new connection starts logged out on the server: restore the login before anything else.
        const token = auth.get();
        if (token) sock.send(JSON.stringify({ t: "auth", token } satisfies ClientMsg));
        const s = store.get();
        if (s) sock.send(JSON.stringify({ t: "resume", ...s } satisfies ClientMsg));
        else markResumed();
        for (const m of queue.current.splice(0)) sock.send(JSON.stringify(m));
      };
      sock.onmessage = (e) => {
        const m: ServerMsg = JSON.parse(e.data);
        if (m.t === "account") {
          auth.set(m.token);
          setAccount(m.account);
          setCreated(m.created);
          setError(null);
          authChecked();
        } else if (m.t === "session") {
          store.set({ code: m.code, token: m.token });
          setError(null);
        } else if (m.t === "state") {
          setView(m.view);
          setDeadline(m.view.remainingMs > 0 ? performance.now() + m.view.remainingMs : 0);
          markResumed();
        } else if (m.t === "peek") {
          setPeekHost(m.host);
        } else if (m.t === "error") {
          if (m.code === "auth_lost" || m.code === "login_required") {
            auth.set(null);
            setAccount(null);
            // An expired saved login on load isn't worth an error message.
            if (!checkingRef.current) setError({ code: m.code, message: m.message });
            authChecked();
          } else if (m.code === "session_lost") {
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
    else if (m.t === "create" || m.t === "join" || m.t === "peek" || m.t === "login") queue.current.push(m);
  }, []);

  const leave = useCallback(() => {
    send({ t: "leave" });
    store.set(null);
    setView(null);
    // Refresh the account's question count after a match.
    const token = auth.get();
    if (token) send({ t: "auth", token });
  }, [send]);

  const login = useCallback((email: string, pin: string) => send({ t: "login", email, pin }), [send]);

  const logout = useCallback(() => {
    if (store.get()) leave();
    send({ t: "logout" });
    auth.set(null);
    setAccount(null);
    setCreated(false);
  }, [send, leave]);

  return {
    online,
    resuming,
    account,
    created,
    checkingAuth,
    login,
    logout,
    view,
    deadline,
    error,
    peekHost,
    send,
    clearError: () => setError(null),
    leave,
  };
}
