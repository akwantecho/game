import { useEffect, useState } from "react";
import { CODE_LENGTH, GOALS, POWER_TIME_S, PRESETS, ROUNDS, SIZES, TIME_LIMITS, describeRules, presetOf, type Rules } from "../shared/game";
import type { AccountView, ClientMsg, RoomView } from "../shared/protocol";
import { COLORS } from "./theme";
import logo from "./assets/logo.png";

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

// The host's last rules come back the next time they create a room.
const RULES_KEY = "lettersWar.rules";
const readRules = (): Partial<Rules> | undefined => {
  try {
    return JSON.parse(localStorage.getItem(RULES_KEY) ?? "null") ?? undefined;
  } catch {
    return undefined;
  }
};
const saveRules = (r: Rules) => {
  try {
    localStorage.setItem(RULES_KEY, JSON.stringify(r));
  } catch {
    /* ignore */
  }
};

const inviteUrl = (code: string) => `${location.origin}${location.pathname}?room=${code}`;

/** First screen on each phone: your name, then create a room or join one. */
const EMAIL_KEY = "lettersWar.email";
const readEmail = () => {
  try {
    return localStorage.getItem(EMAIL_KEY) ?? "";
  } catch {
    return "";
  }
};
const saveEmail = (e: string) => {
  try {
    localStorage.setItem(EMAIL_KEY, e);
  } catch {
    /* ignore */
  }
};
/** Arabic keyboards type ٠-٩ (or Persian ۰-۹): the PIN is stored with 0-9. */
const latinDigits = (s: string) =>
  s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0));
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Email and a 4-digit PIN. The first login with an email creates the account with that PIN. */
export function Login({
  invite,
  error,
  onLogin,
  onEdit,
}: {
  invite: string | null;
  error: string | null;
  onLogin: (email: string, pin: string) => void;
  onEdit: () => void;
}) {
  const [email, setEmail] = useState(readEmail);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => setBusy(false), [error]);
  const clean = email.trim().toLowerCase();
  const ok = EMAIL.test(clean) && /^[0-9]{4}$/.test(pin);
  return (
    <form
      className="screen entry"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ok || busy) return;
        saveEmail(clean);
        setBusy(true);
        onLogin(clean, pin);
      }}
    >
      <div className="kicker">{invite ? `دعوة إلى الغرفة ${invite}` : "تسجيل الدخول"}</div>
      <div className="logo-wrap small" style={{ ["--logo" as string]: `url(${logo})` }}>
        <img className="logo" src={logo} alt="حرب الحروف" draggable={false} />
      </div>
      <div className="field">
        <label htmlFor="email" className="lg">
          البريد الإلكتروني
        </label>
        <input
          id="email"
          className="input name ltr"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="off"
          spellCheck={false}
          maxLength={254}
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            onEdit();
          }}
          placeholder="name@example.com"
        />
      </div>
      <div className="field">
        <label htmlFor="pin" className="lg">
          رمز الدخول (4 أرقام)
        </label>
        <input
          id="pin"
          className="input pin"
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          pattern="[0-9]*"
          maxLength={4}
          value={pin}
          onChange={(e) => {
            setPin(latinDigits(e.target.value).replace(/[^0-9]/g, "").slice(0, 4));
            onEdit();
          }}
          placeholder="••••"
        />
      </div>
      <p className="hint-note">أول مرة؟ اكتب بريدك واختر 4 أرقام تتذكرها. سننشئ حسابك بها، وتدخل بها في كل مرة، ولن تتكرر عليك الأسئلة.</p>
      <div className="field-error" role="alert">
        {error}
      </div>
      <div className="spacer" />
      <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={!ok || busy}>
        {busy ? "جارٍ الدخول…" : "دخول"}
      </button>
    </form>
  );
}

export function Entry({
  invite,
  inviteHost,
  error,
  account,
  created,
  onLogout,
  onCreate,
  onJoin,
}: {
  invite: string | null;
  inviteHost: string | null;
  error: string | null;
  account: AccountView;
  created: boolean;
  onLogout: () => void;
  onCreate: (name: string, rules: Partial<Rules> | undefined) => void;
  onJoin: (name: string) => void;
}) {
  const [name, setName] = useState(() => readName() || account.name);
  const clean = name.trim();
  const go = (fn: () => void) => {
    saveName(clean);
    fn();
  };
  return (
    <div className="screen entry">
      <div className="account-bar">
        <span className="account-email" dir="ltr">
          {account.email}
        </span>
        <button className="btn btn-ghost top" onClick={onLogout}>
          خروج
        </button>
      </div>
      <div className="kicker">{invite ? `دعوة إلى الغرفة ${invite}` : created ? "أهلاً بك! أُنشئ حسابك." : "مباراة عبر جهازين"}</div>
      <div className="logo-wrap" style={{ ["--logo" as string]: `url(${logo})` }}>
        <img className="logo" src={logo} alt="حرب الحروف" draggable={false} />
      </div>
      {invite && inviteHost && <h1 className="invite-title">{inviteHost} يدعوك إلى حرب الحروف</h1>}
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
      <p className="hint-note">
        {account.seen
          ? `سُئلت ${account.seen} من ${account.total} سؤالاً حتى الآن، ولن يتكرر عليك أي منها حتى تنتهي البقية.`
          : `أمامك ${account.total} سؤالاً، ولن يتكرر عليك أي منها حتى تنتهي كلها.`}
      </p>
      <div className="field-error">{error}</div>
      <div className="spacer" />
      {invite ? (
        <button className="btn btn-primary btn-block btn-lg" disabled={!clean} onClick={() => go(() => onJoin(clean))}>
          متابعة
        </button>
      ) : (
        <div>
          <button className="btn btn-primary btn-block btn-lg" disabled={!clean} onClick={() => go(() => onCreate(clean, readRules()))}>
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
  const rulesKey = JSON.stringify(view.rules);
  useEffect(() => saveRules(JSON.parse(rulesKey)), [rulesKey]);
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
    <div className="screen scroll">
      <div className="screen-top">
        <div className="kicker">غرفة جديدة</div>
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
      <RulesEditor rules={view.rules} onChange={(rules) => send({ t: "rules", rules })} />
      <div className="spacer" />
      <div className="sticky-foot">
        <button className="btn btn-primary btn-block btn-lg" disabled={!guest?.connected} onClick={() => send({ t: "start" })}>
          {guest ? "ابدأ المباراة" : "بانتظار المنافس"}
        </button>
      </div>
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
    <div className="screen scroll">
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
      <section className="rules" aria-labelledby="rules-title">
        <div className="rules-head">
          <span id="rules-title" className="rules-title">
            قواعد المباراة
          </span>
          <PresetTag rules={view.rules} />
        </div>
        <ul className="rules-list">
          <li>
            {view.rules.timeLimit} ثانية للإجابة · لوحة {view.rules.size}×{view.rules.size}
          </li>
          {describeRules(view.rules).map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </section>
      <div className="spacer" />
    </div>
  );
}

function PresetTag({ rules }: { rules: Rules }) {
  const id = presetOf(rules);
  return <span className="tag tag-neutral">{PRESETS.find((p) => p.id === id)?.name ?? "مخصصة"}</span>;
}

function Seg<T extends string | number>({
  name,
  label,
  options,
  value,
  onChange,
}: {
  name: string;
  label: string;
  options: readonly { value: T; label: string }[];
  value: T | null;
  onChange: (v: T) => void;
}) {
  return (
    <div className="rule">
      <span className="rule-label" id={`${name}-label`}>
        {label}
      </span>
      <div className="seg full" role="radiogroup" aria-labelledby={`${name}-label`}>
        {options.map((o) => (
          <label key={o.value} className="seg-opt">
            <input type="radio" name={name} checked={value === o.value} onChange={() => onChange(o.value)} />
            {o.label}
          </label>
        ))}
      </div>
    </div>
  );
}

function Switch({
  label,
  note,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  note: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className={`switch-row${disabled ? " off" : ""}`}>
      <span className="switch-text">
        <b>{label}</b>
        <small>{note}</small>
      </span>
      <input type="checkbox" role="switch" checked={checked && !disabled} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" aria-hidden />
    </label>
  );
}

/** The host's rule controls. Every change goes to the server, which echoes the rules to both phones. */
function RulesEditor({ rules, onChange }: { rules: Rules; onChange: (patch: Partial<Rules>) => void }) {
  const gift = rules.penalty === "gift";
  return (
    <section className="rules" aria-labelledby="rules-title">
      <div className="rules-head">
        <span id="rules-title" className="rules-title">
          قواعد المباراة
        </span>
        <PresetTag rules={rules} />
      </div>
      <Seg
        name="preset"
        label="نمط جاهز"
        options={PRESETS.map((p) => ({ value: p.id, label: p.name }))}
        value={presetOf(rules)}
        onChange={(id) => onChange(PRESETS.find((p) => p.id === id)!.rules)}
      />
      <Seg
        name="limit"
        label="وقت الإجابة"
        options={TIME_LIMITS.map((t) => ({ value: t as number, label: `${t} ثانية` }))}
        value={rules.timeLimit}
        onChange={(timeLimit) => onChange({ timeLimit })}
      />
      <Seg
        name="size"
        label="حجم اللوحة"
        options={SIZES.map((n) => ({ value: n as number, label: `${n}×${n}` }))}
        value={rules.size}
        onChange={(size) => onChange({ size })}
      />
      <Seg
        name="rounds"
        label="عدد الجولات"
        options={ROUNDS.map((n) => ({ value: n as number, label: n === 1 ? "جولة واحدة" : `${n} جولات` }))}
        value={rules.rounds}
        onChange={(rounds) => onChange({ rounds })}
      />
      <Seg
        name="mode"
        label="طريقة اللعب"
        options={[
          { value: "turns", label: "بالدور" },
          { value: "buzzer", label: "الجرس" },
        ]}
        value={rules.mode}
        onChange={(mode) => onChange({ mode })}
      />
      <Seg
        name="penalty"
        label="عقوبة الخطأ"
        options={[
          { value: "none", label: "بدون" },
          { value: "lock", label: "قفل الخلية" },
          { value: "gift", label: "للخصم" },
        ]}
        value={rules.penalty}
        onChange={(penalty) => onChange({ penalty })}
      />
      <Switch
        label="السرقة"
        note={gift ? "لا تعمل مع عقوبة «للخصم»: الخلية تذهب إليه مباشرة." : "إذا أخطأ أحدكما يحاول الآخر بوقت أقصر."}
        checked={rules.steal}
        disabled={gift}
        onChange={(steal) => onChange({ steal })}
      />
      <Switch
        label="خلايا خاصة"
        note="ذهبية تمنح دوراً إضافياً، قنبلة تُخسرك خلية، خاطفة بنصف الوقت."
        checked={rules.specials}
        onChange={(specials) => onChange({ specials })}
      />
      <Switch
        label="قوى مساعدة"
        note={`تخطي السؤال، +${POWER_TIME_S} ثوانٍ، تلميح. مرة واحدة لكل لاعب.`}
        checked={rules.powers}
        onChange={(powers) => onChange({ powers })}
      />
      <Switch
        label="اختيار المجال"
        note="صاحب الدور يختار مجال السؤال بعد الحرف."
        checked={rules.categories}
        onChange={(categories) => onChange({ categories })}
      />
    </section>
  );
}
