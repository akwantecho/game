import { useEffect, useRef, useState, type CSSProperties } from "react";
import { BUZZ_ANSWER_S, GOALS_SHORT, POWER_TIME_S, SPECIALS, type PowerKind, type Seat, type Special } from "../shared/game";
import type { Attempt, ClientMsg, RoomView } from "../shared/protocol";
import { Badge, Board } from "./Board";
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

const POWERS: { kind: PowerKind; label: string }[] = [
  { kind: "skip", label: "تخطي السؤال" },
  { kind: "time", label: `+${POWER_TIME_S} ثوانٍ` },
  { kind: "hint", label: "تلميح" },
];

export function Game({ view, deadline, send, onLeave }: Props) {
  const me = view.you;
  const opp = (1 - me) as Seat;
  const name = (s: Seat) => view.players[s]?.name ?? "";
  const { phase, rules, q } = view;
  const won = phase === "won";
  // While a question is open the turn is about whoever answers it; otherwise about the picker.
  const focus = phase === "question" && view.answerer !== null ? view.answerer : view.current;
  const mine = focus === me;
  const cur = COLORS[focus];
  const oppOffline = view.players[opp] && !view.players[opp]!.connected;

  const remaining = useRemaining(deadline);
  const secs = Math.ceil(remaining / 1000);

  // The typed answer stays on this phone until it is sent.
  const [answer, setAnswer] = useState("");
  const [sent, setSent] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const windowKey = phase === "question" || phase === "buzz" ? `${phase}:${view.turn}:${view.answerer}:${q?.question}` : "";
  useEffect(() => {
    setAnswer("");
    setSent(false);
    if (windowKey.startsWith("question") && mine) setTimeout(() => input.current?.focus({ preventScroll: true }), 60);
  }, [windowKey, mine]);

  const submit = (text: string) => {
    if (sent) return;
    setSent(true);
    send({ t: "answer", text });
  };

  const tried = (a: Attempt) =>
    a.kind === "timeout" ? "لم يُرسل إجابة" : a.kind === "pass" ? "مرّر الفرصة" : a.given || "—";
  const res = view.result;
  const missedBy = res?.attempts[0] && !res.attempts[0].ok ? res.attempts[0].seat : null;

  const questionHead = q && (
    <>
      <div className="q-head">
        <Medal letter={q.letter} seat={focus} />
        <div className="q-tags">
          <span className="tag tag-neutral">{q.category}</span>
          {view.active !== null && view.specials[view.active] && <SpecialTag kind={view.specials[view.active]!} />}
        </div>
        <Ring remaining={remaining} total={view.windowMs} secs={Math.max(0, secs)} />
      </div>
      <div className="q-text">{q.question}</div>
    </>
  );

  const resultTitle =
    res &&
    (res.ok
      ? res.attempts.length > 1
        ? `سرقها ${name(res.owner!)}!`
        : "إجابة صحيحة"
      : res.gift
        ? `الخلية لـ ${name(res.owner!)}`
        : !res.attempts.length
          ? "لم يضغط أحد الجرس"
          : res.attempts[0].kind === "timeout"
            ? "انتهى الوقت"
            : "إجابة خاطئة");
  const resultIcon = res?.ok || res?.gift ? "ok" : res && (!res.attempts.length || res.attempts[0].kind === "timeout") ? "time" : "no";

  return (
    <div className={`game${phase === "question" || phase === "buzz" ? " asking" : ""}`}>
      <header className="duel">
        <SeatCard view={view} seat={me} on={!won && focus === me} />
        <div className="duel-mid">
          {rules.rounds > 1 ? (
            <div className="session-bar">
              <span className="sb-score" aria-label={`النقاط ${view.wins[me]} مقابل ${view.wins[opp]}`}>
                <b style={{ color: COLORS[me].c7 }}>{view.wins[me]}</b>
                <span className="sb-dash">—</span>
                <b style={{ color: COLORS[opp].c7 }}>{view.wins[opp]}</b>
              </span>
              <span className="sb-round">
                الجولة {view.round} من {rules.rounds}
              </span>
            </div>
          ) : (
            <span className="duel-vs">ضد</span>
          )}
        </div>
        <SeatCard view={view} seat={opp} on={!won && focus === opp} />
      </header>

      <section className="arena">
        <Board view={view} onPick={(cell) => send({ t: "pick", cell })} />
        {rules.specials && (
          <div className="legend">
            {(Object.keys(SPECIALS) as Special[]).map((k) => (
              <span key={k} className={`chip sp-${k}`} title={SPECIALS[k].note}>
                <svg viewBox="-10 -10 20 20" aria-hidden>
                  <Badge kind={k} x={0} y={0} />
                </svg>
                <b>{SPECIALS[k].name}</b>
                <span>{SPECIALS[k].note}</span>
              </span>
            ))}
          </div>
        )}
      </section>

      <div className="panel" aria-live="polite" style={{ "--seat": cur.c, "--seat-7": cur.c7, "--seat-1": cur.c1 } as CSSProperties}>
        {phase === "pick" && (
          <div className="stack-2">
            <div className="turn">
              <Avatar view={view} seat={view.current} pulse />
              <div className="stack-1">
                <div className="round">الدور {view.turn}</div>
                <div className="pick-title" style={{ color: mine ? COLORS[me].c7 : "var(--color-text)" }}>
                  {mine ? "دورك" : `دور ${name(opp)}`}
                </div>
                <div className="note">
                  {mine
                    ? rules.mode === "buzzer"
                      ? "اختر حرفاً، ثم يتسابق كلاكما على الجرس."
                      : "اختر أي حرف محايد من اللوحة."
                    : "ينتظر أن يختار حرفاً…"}
                </div>
              </div>
            </div>
            {view.locked.length > 0 && <div className="banner">الخلية المقفلة لا تُختار في هذا الدور.</div>}
            {oppOffline && <div className="banner steal">انقطع اتصال {name(opp)}. ننتظر عودته…</div>}
          </div>
        )}

        {phase === "category" && view.active !== null && (
          <div className="stack-2">
            <div className="q-head">
              <Medal letter={view.letters[view.active]} seat={focus} />
              <div className="stack-1 grow">
                <div className="round">اختيار المجال</div>
                <div className="note">{mine ? "اختر مجال السؤال:" : `${name(opp)} يختار مجال السؤال…`}</div>
              </div>
            </div>
            {mine && (
              <div className="cats">
                {view.categories.map((c) => (
                  <button key={c} className="btn btn-secondary btn-md" onClick={() => send({ t: "category", name: c })}>
                    {c}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {phase === "buzz" && q && (
          <div className="stack-2">
            {questionHead}
            <button className="btn btn-primary btn-block btn-lg buzz" disabled={sent} onClick={() => (setSent(true), send({ t: "buzz" }))}>
              {sent ? "ضغطت…" : "الجرس!"}
            </button>
            <div className="note muted">أول من يضغط يجيب خلال {BUZZ_ANSWER_S} ثوانٍ.</div>
          </div>
        )}

        {phase === "question" && q && (
          <div className="stack-2">
            {questionHead}
            {view.stealing && view.attempts[0] ? (
              <div className="banner steal">
                <b>فرصة سرقة!</b> {name(view.attempts[0].seat)}: {tried(view.attempts[0])}
              </div>
            ) : (
              rules.mode === "buzzer" && <div className="banner">{mine ? "ضغطت الجرس أولاً." : `${name(opp)} ضغط الجرس أولاً.`}</div>
            )}
            {mine ? (
              <>
                {view.hint && (
                  <div className="hint">
                    تلميح: <span className="mask">{view.hint.mask}</span> · {view.hint.letters} حروف
                  </div>
                )}
                <form
                  className="answer-row"
                  onSubmit={(e) => {
                    e.preventDefault();
                    submit(answer);
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
                {view.stealing && (
                  <button className="btn btn-ghost" disabled={sent} onClick={() => submit("")}>
                    تمرير الفرصة
                  </button>
                )}
                {rules.powers && (
                  <div className="powers" role="group" aria-label="القوى المساعدة، مرة واحدة لكل منها">
                    {POWERS.map((p) => {
                      const used = view.powers[me][p.kind];
                      const off = used || sent || (p.kind === "skip" && !view.canSkip);
                      return (
                        <button key={p.kind} className="power" disabled={off} onClick={() => send({ t: "power", kind: p.kind })}>
                          {p.label}
                          <small>{used ? "استُخدمت" : "مرة واحدة"}</small>
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            ) : (
              <div className="note muted">
                {name(opp)} {view.stealing ? "يحاول السرقة الآن…" : "يكتب إجابته الآن…"} لا ترى إجابته حتى يرسلها.
              </div>
            )}
          </div>
        )}

        {(phase === "result" || won) && q && res && (
          <div className="stack-2">
            <div className="result-head">
              <span className={`result-icon ${resultIcon}`} style={res.owner !== null ? { background: COLORS[res.owner].c } : undefined}>
                <Icon kind={resultIcon} />
              </span>
              <div className="stack-1">
                <div className="round">
                  {name(view.current)} · «{q.letter}»
                </div>
                <div className="result-title" style={{ color: res.owner !== null ? COLORS[res.owner].c7 : "var(--color-text)" }}>
                  {resultTitle}
                </div>
              </div>
            </div>
            {res.attempts.length > 0 && (
              <ul className="attempts">
                {res.attempts.map((a, k) => (
                  <li key={k} className={a.ok ? "ok" : undefined}>
                    <span className="who" style={{ color: COLORS[a.seat].c7 }}>
                      {name(a.seat)}
                      {k > 0 && <small> (سرقة)</small>}
                    </span>
                    <span className="said">{tried(a)}</span>
                    <Icon kind={a.ok ? "ok" : a.kind === "timeout" ? "time" : "no"} />
                  </li>
                ))}
              </ul>
            )}
            <div className="reveal">
              الإجابة <b>{q.answer}</b>
            </div>
            {res.gift && <div className="effect">عقوبة الخطأ: ذهبت الخلية إلى {name(res.owner!)}.</div>}
            {res.locked && <div className="effect">قُفلت الخلية في الدور القادم.</div>}
            {res.lost !== null && missedBy !== null && (
              <div className="effect">
                القنبلة أخذت خلية «{view.letters[res.lost]}» من {name(missedBy)}.
              </div>
            )}
            {res.bonus && !won && <div className="effect gold">خلية ذهبية: {name(res.owner!)} يلعب مرة أخرى.</div>}
          </div>
        )}
      </div>

      {won && view.winner !== null && (
        <div
          className={`win${view.sessionOver ? " session" : ""}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby="win-title"
        >
          {view.sessionOver && (
            <div className="confetti" aria-hidden>
              {Array.from({ length: 18 }).map((_, i) => (
                <i key={i} style={{ "--i": i } as CSSProperties} />
              ))}
            </div>
          )}
          <div className="kicker">
            {view.sessionOver ? "النتيجة النهائية" : `انتهت الجولة ${view.round} من ${rules.rounds}`}
          </div>
          <div
            id="win-title"
            className="win-title"
            style={{ color: COLORS[view.sessionOver ? (view.sessionWinner ?? view.winner) : view.winner].c7 }}
          >
            {view.sessionOver
              ? view.sessionWinner === null
                ? "تعادل!"
                : view.sessionWinner === me
                  ? "🏆 أنت البطل!"
                  : `🏆 البطل ${name(opp)}`
              : view.winner === me
                ? "فزت بالجولة!"
                : `فاز ${name(opp)} بالجولة`}
          </div>
          {rules.rounds > 1 && (
            <div className="score-final">
              <span>
                <b style={{ color: COLORS[me].c7 }}>{view.wins[me]}</b> {name(me)}
              </span>
              <span className="vs">—</span>
              <span>
                {name(opp)} <b style={{ color: COLORS[opp].c7 }}>{view.wins[opp]}</b>
              </span>
            </div>
          )}
          <div className="lede">
            إجاباتك في هذه الجولة: {view.stats[me].c} صحيحة و{view.stats[me].w} خاطئة.
          </div>
          <button className="btn btn-primary btn-block btn-lg" onClick={() => send({ t: "rematch" })}>
            {view.sessionOver ? "مباراة جديدة" : "الجولة التالية"}
          </button>
          <button className="btn btn-ghost btn-block" onClick={onLeave}>
            مغادرة الغرفة
          </button>
        </div>
      )}
    </div>
  );
}

function SpecialTag({ kind }: { kind: Special }) {
  return (
    <span className={`tag sp-tag sp-${kind}`}>
      <svg viewBox="-10 -10 20 20" aria-hidden>
        <Badge kind={kind} x={0} y={0} />
      </svg>
      {SPECIALS[kind].name}
    </span>
  );
}

const initial = (name: string) => Array.from(name.trim())[0] ?? "؟";
const seatVars = (seat: Seat) => ({ "--seat": COLORS[seat].c, "--seat-7": COLORS[seat].c7, "--seat-glow": COLORS[seat].glow }) as CSSProperties;

/** A hex badge with the player's first letter, in their team color. */
function Avatar({ view, seat, pulse }: { view: RoomView; seat: Seat; pulse?: boolean }) {
  return (
    <span className={`avatar${pulse ? " pulse" : ""}`} style={seatVars(seat)} aria-hidden>
      {initial(view.players[seat]?.name ?? "")}
    </span>
  );
}

function SeatCard({ view, seat, on }: { view: RoomView; seat: Seat; on: boolean }) {
  const p = view.players[seat];
  return (
    <div className={`seat-card${on ? " on" : ""}`} style={seatVars(seat)}>
      <Avatar view={view} seat={seat} />
      <div className="seat-info">
        <div className="seat-name">
          <span>{p?.name}</span>
          {seat === view.you ? <small>أنت</small> : !p?.connected && <small className="off">غير متصل</small>}
        </div>
        <div className="seat-meta">
          <span className="count">
            <i className="mini-hex" aria-hidden />
            {view.owners.filter((o) => o === seat).length}
          </span>
          خلايا
          <span className="goal" title={GOALS_SHORT[seat]} aria-label={GOALS_SHORT[seat]}>
            {seat === 0 ? "↔" : "↕"}
          </span>
        </div>
      </div>
    </div>
  );
}

/** The question's letter on a raised hex tile in the answering player's color. */
function Medal({ letter, seat }: { letter: string; seat: Seat }) {
  return (
    <span className="medal" style={seatVars(seat)}>
      <span>{letter}</span>
    </span>
  );
}

/** Countdown ring: the arc empties as the window runs out. */
function Ring({ remaining, total, secs }: { remaining: number; total: number; secs: number }) {
  const r = 21;
  const len = 2 * Math.PI * r;
  const frac = total ? Math.min(1, remaining / total) : 0;
  return (
    <span className={`ring${secs <= 5 ? " low" : ""}`} role="timer" aria-label={`${secs} ثانية`}>
      <svg viewBox="0 0 50 50" aria-hidden>
        <circle className="ring-track" cx="25" cy="25" r={r} />
        <circle className="ring-arc" cx="25" cy="25" r={r} strokeDasharray={len.toFixed(1)} strokeDashoffset={(len * (1 - frac)).toFixed(1)} />
      </svg>
      <b>{secs}</b>
    </span>
  );
}

function Icon({ kind }: { kind: "ok" | "no" | "time" }) {
  return (
    <svg className={`icon ${kind}`} viewBox="0 0 24 24" aria-hidden>
      {kind === "ok" ? (
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      ) : kind === "no" ? (
        <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
      ) : (
        <>
          <circle cx="12" cy="13" r="7.5" />
          <path d="M12 9v4.5l3 2M9.5 3h5" />
        </>
      )}
    </svg>
  );
}
