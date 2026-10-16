import { useEffect, useRef, useState } from "react";
import { GOALS_SHORT, type Seat } from "../shared/game";
import type { ClientMsg, RoomView } from "../shared/protocol";
import { Board } from "./Board";
import { COLORS } from "./theme";

interface Props {
  view: RoomView;
  deadline: number;
  send: (m: ClientMsg) => void;
  onLeave: () => void;
}

/** Counts down to a local performance.now() deadline, ticking every 100ms. */
function useRemaining(deadline: number) {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (!deadline) return;
    setNow(performance.now());
    const iv = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(iv);
  }, [deadline]);
  return deadline ? Math.max(0, deadline - now) : 0;
}

export function Game({ view, deadline, send, onLeave }: Props) {
  const me = view.you;
  const opp = (1 - me) as Seat;
  const name = (s: Seat) => view.players[s]?.name ?? "";
  const mine = view.current === me;
  const won = view.phase === "won";
  const cur = COLORS[view.current];
  const q = view.q;
  const oppOffline = view.players[opp] && !view.players[opp]!.connected;

  const remaining = useRemaining(deadline);
  const secs = Math.ceil(remaining / 1000);
  const timerColor = secs <= 5 ? "var(--color-accent-2-600)" : "var(--color-text)";

  // The typed answer stays on this phone until it is sent.
  const [answer, setAnswer] = useState("");
  const [sent, setSent] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const questionKey = view.phase === "question" ? `${view.turn}:${view.active}` : "";
  useEffect(() => {
    setAnswer("");
    setSent(false);
    if (questionKey && mine) setTimeout(() => input.current?.focus({ preventScroll: true }), 60);
  }, [questionKey, mine]);

  const submit = () => {
    if (sent) return;
    setSent(true);
    send({ t: "answer", text: answer });
  };

  const res = view.result;

  return (
    <div className="game">
      <div className="strip">
        {[me, opp].map((i) => (
          <div
            key={i}
            className={`strip-item${view.current === i ? " on" : ""}`}
            style={view.current === i ? { borderTopColor: COLORS[i].c } : undefined}
          >
            <div className="strip-name">
              {name(i)}
              <small>{i === me ? "(أنت)" : view.players[i]?.connected ? "" : "(غير متصل)"}</small>
            </div>
            <div className="strip-meta">
              {view.owners.filter((o) => o === i).length} خلايا · {GOALS_SHORT[i]}
            </div>
          </div>
        ))}
      </div>

      <Board view={view} onPick={(cell) => send({ t: "pick", cell })} />

      <div className="panel" aria-live="polite">
        {view.phase === "pick" && (
          <div className="stack-1">
            <div className="round">الجولة {view.turn}</div>
            <div className="pick-title" style={{ color: mine ? COLORS[me].c7 : "var(--color-text)" }}>
              {mine ? "دورك" : `دور ${name(opp)}`}
            </div>
            <div className="note">{mine ? "اختر أي حرف محايد من اللوحة." : "ينتظر أن يختار حرفاً…"}</div>
            {oppOffline && <div className="note muted">انقطع اتصال {name(opp)}. ننتظر عودته…</div>}
          </div>
        )}

        {view.phase === "question" && q && (
          <div className="stack-2">
            <div className="q-head">
              <div className="q-letter-row">
                <span className="q-letter" style={{ color: cur.c }}>
                  {q.letter}
                </span>
                <span className="tag tag-neutral">{q.category}</span>
              </div>
              <span className="timer" style={{ color: timerColor }} role="timer">
                00:{String(Math.max(0, secs)).padStart(2, "0")}
              </span>
            </div>
            <div className="timer-bar">
              <div style={{ width: `${((remaining / (view.timeLimit * 1000)) * 100).toFixed(1)}%`, background: timerColor }} />
            </div>
            <div className="q-text">{q.question}</div>
            {mine ? (
              <form
                className="answer-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  submit();
                }}
              >
                <input
                  ref={input}
                  className="input"
                  autoComplete="off"
                  autoCorrect="off"
                  enterKeyHint="send"
                  aria-label="إجابتك"
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  placeholder={`إجابة تبدأ بـ «${q.letter}»`}
                  disabled={sent}
                />
                <button className="btn btn-primary" type="submit" disabled={sent}>
                  إرسال
                </button>
              </form>
            ) : (
              <div className="note muted">{name(opp)} يكتب إجابته الآن… لا ترى إجابته حتى يرسلها.</div>
            )}
          </div>
        )}

        {(view.phase === "result" || won) && q && res && (
          <div className="stack-1">
            <div className="round">
              {name(view.current)} · «{q.letter}»
            </div>
            <div className="result-title" style={{ color: res.ok ? cur.c7 : "var(--color-text)" }}>
              {res.ok ? "إجابة صحيحة" : res.kind === "timeout" ? "انتهى الوقت" : "إجابة خاطئة"}
            </div>
            <div className="result-line">كتب: {res.kind === "timeout" ? "لم تُرسل إجابة" : res.given || "—"}</div>
            <div className="result-line">
              الإجابة: <b>{q.answer}</b>
            </div>
          </div>
        )}
      </div>

      {won && view.winner !== null && (
        <div className="win" role="dialog" aria-modal="true" aria-labelledby="win-title">
          <div className="kicker">اكتمل المسار في الجولة {view.turn}</div>
          <div id="win-title" className="win-title" style={{ color: COLORS[view.winner].c7 }}>
            {view.winner === me ? "فزت!" : `فاز ${name(opp)}`}
          </div>
          <div className="lede">
            إجاباتك: {view.stats[me].c} صحيحة و{view.stats[me].w} خاطئة.
          </div>
          <button className="btn btn-primary btn-block btn-lg" onClick={() => send({ t: "rematch" })}>
            مباراة أخرى
          </button>
          <button className="btn btn-ghost btn-block" onClick={onLeave}>
            مغادرة الغرفة
          </button>
        </div>
      )}
    </div>
  );
}
