import { useEffect, useState } from "react";
import { CODE_LENGTH, GOALS, TIME_LIMITS } from "../shared/game";
import type { ClientMsg, RoomView } from "../shared/protocol";
import { COLORS } from "./theme";

const NAME_KEY = "lettersWar.name";
const readName = () => {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
};
const saveName = (n: string) => {
  try {
    localStorage.setItem(NAME_KEY, n);
  } catch {
    /* ignore */
  }
};

const inviteUrl = (code: string) => `${location.origin}${location.pathname}?room=${code}`;

/** First screen on each phone: your name, then create a room or join one. */
export function Entry({
  invite,
  inviteHost,
  error,
  onCreate,
  onJoin,
}: {
  invite: string | null;
  inviteHost: string | null;
  error: string | null;
  onCreate: (name: string, timeLimit: number) => void;
  onJoin: (name: string) => void;
}) {
  const [name, setName] = useState(readName);
  const [limit, setLimit] = useState(20);
  const clean = name.trim();
  const go = (fn: () => void) => {
    saveName(clean);
    fn();
  };
  return (
    <div className="screen">
      <div className="kicker">{invite ? `دعوة إلى الغرفة ${invite}` : "مباراة عبر جهازين"}</div>
      <h1>{invite && inviteHost ? `${inviteHost} يدعوك إلى حرب الحروف` : "حرب الحروف"}</h1>
      <div className="field">
        <label htmlFor="name" className="lg">
          اسمك
        </label>
        <input
          id="name"
          className="input name"
          autoComplete="nickname"
          maxLength={20}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="اكتب اسمك"
        />
      </div>
      {!invite && (
        <div className="field">
          <label className="lg" id="limit-label">
            وقت الإجابة
          </label>
          <div className="seg full" role="radiogroup" aria-labelledby="limit-label">
            {TIME_LIMITS.map((t) => (
              <label key={t} className="seg-opt">
                <input type="radio" name="limit" checked={limit === t} onChange={() => setLimit(t)} />
                {t} ثانية
              </label>
            ))}
          </div>
        </div>
      )}
      <div className="field-error">{error}</div>
      <div className="spacer" />
      {invite ? (
        <button className="btn btn-primary btn-block btn-lg" disabled={!clean} onClick={() => go(() => onJoin(clean))}>
          متابعة
        </button>
      ) : (
        <div>
          <button className="btn btn-primary btn-block btn-lg" disabled={!clean} onClick={() => go(() => onCreate(clean, limit))}>
            إنشاء غرفة
          </button>
          <button className="btn btn-secondary btn-block btn-md" disabled={!clean} onClick={() => go(() => onJoin(clean))}>
            الانضمام إلى غرفة
          </button>
        </div>
      )}
    </div>
  );
}

export function HostLobby({ view, send, onLeave }: { view: RoomView; send: (m: ClientMsg) => void; onLeave: () => void }) {
  const guest = view.players[1];
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  const share = async () => {
    const url = inviteUrl(view.code);
    if (navigator.share) {
      try {
        await navigator.share({ title: "حرب الحروف", text: `انضم إلى غرفتي في حرب الحروف. الرمز: ${view.code}`, url });
        return;
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      /* clipboard blocked: the code is on screen */
    }
    setCopied(true);
  };

  const roster = [
    { name: view.players[0].name, color: COLORS[0].c, status: "متصل", ok: true },
    guest
      ? { name: guest.name, color: COLORS[1].c, status: guest.connected ? "انضم" : "غير متصل", ok: guest.connected }
      : { name: "المنافس", color: COLORS[1].c, status: "بانتظار الانضمام…", ok: false },
  ];

  return (
    <div className="screen">
      <div className="screen-top">
        <div className="kicker">غرفة جديدة · {view.timeLimit} ثانية للإجابة</div>
        <button className="btn btn-ghost top" onClick={onLeave}>
          إلغاء
        </button>
      </div>
      <h2>أرسل الرمز إلى {guest ? guest.name : "منافسك"}</h2>
      <div className="room-code" aria-label={`رمز الغرفة ${view.code.split("").join(" ")}`}>
        {view.code}
      </div>
      <button className="btn btn-secondary btn-block btn-md" onClick={share}>
        {copied ? "نُسخ الرابط" : "مشاركة رابط الدعوة"}
      </button>
      <div className="roster">
        {roster.map((m) => (
          <div key={m.name + m.status} className="roster-row">
            <span className="who">
              <span className="hexdot" style={{ background: m.color }} />
              {m.name}
            </span>
            <span className={`status${m.ok ? " ok" : ""}`}>{m.status}</span>
          </div>
        ))}
      </div>
      <div className="spacer" />
      <button className="btn btn-primary btn-block btn-lg" disabled={!guest?.connected} onClick={() => send({ t: "start" })}>
        {guest ? "ابدأ المباراة" : "بانتظار المنافس"}
      </button>
    </div>
  );
}

export function GuestJoin({
  name,
  initialCode,
  host,
  error,
  onCode,
  onJoin,
  onBack,
}: {
  name: string;
  initialCode: string;
  host: string | null;
  error: string | null;
  onCode: (code: string) => void;
  onJoin: (code: string) => void;
  onBack: () => void;
}) {
  const [code, setCode] = useState(initialCode);
  return (
    <form
      className="screen"
      onSubmit={(e) => {
        e.preventDefault();
        onJoin(code.trim());
      }}
    >
      <div className="screen-top">
        <div className="kicker">الانضمام إلى غرفة</div>
        <button type="button" className="btn btn-ghost top" onClick={onBack}>
          رجوع
        </button>
      </div>
      <h2>أدخل رمز الغرفة</h2>
      <div className="field">
        <label htmlFor="joincode" className="lg">
          {host ? `الرمز من ${host}` : "الرمز من صاحب الغرفة"}
        </label>
        <input
          id="joincode"
          className="input code"
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          maxLength={CODE_LENGTH}
          value={code}
          onChange={(e) => {
            const v = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
            setCode(v);
            onCode(v);
          }}
          placeholder={"•".repeat(CODE_LENGTH)}
        />
      </div>
      <div className="field-error" role="alert">
        {error}
      </div>
      <div className="spacer" />
      <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={code.length !== CODE_LENGTH}>
        انضمام باسم {name}
      </button>
    </form>
  );
}

export function GuestWait({ view, onLeave }: { view: RoomView; onLeave: () => void }) {
  const host = view.players[0];
  return (
    <div className="screen">
      <div className="screen-top">
        <div className="kicker">الغرفة {view.code}</div>
        <button className="btn btn-ghost top" onClick={onLeave}>
          مغادرة
        </button>
      </div>
      <div className="spacer" />
      <h2 className="wait">انضممت. بانتظار أن يبدأ {host.name} المباراة…</h2>
      <p className="lede">ستبني مساراً {GOALS[1]}.</p>
      {!host.connected && <p className="lede muted">انقطع اتصال {host.name}. ننتظر عودته…</p>}
      <div className="spacer" />
    </div>
  );
}
