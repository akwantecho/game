import { useEffect, useRef, useState, type CSSProperties } from "react";
import { SPECIALS, type Seat, type Special } from "../shared/game";
import type { RoomView } from "../shared/protocol";
import { COLORS } from "./theme";

// Geometry from the prototype: pointy-top hexes, R=44, odd rows shifted half a cell.
// Each cell is a raised tile: a dark side drawn DEPTH units below the face.
const R = 44;
const W = Math.sqrt(3) * R;
const PAD = 28;
const DEPTH = 6;
const GAP = 3;

interface Layout {
  vbW: number;
  vbH: number;
  cells: { cx: number; cy: number; face: string; side: string; gloss: string }[];
}

const hex = (cx: number, cy: number, r: number) =>
  [0, 1, 2, 3, 4, 5]
    .map((k) => {
      const a = (Math.PI / 180) * (60 * k - 90);
      return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
    })
    .join(" ");

const layouts = new Map<number, Layout>();
function layout(n: number): Layout {
  let l = layouts.get(n);
  if (l) return l;
  const vbW = PAD * 2 + W * (n + 0.5);
  const vbH = PAD * 2 + R * 2 + (n - 1) * 1.5 * R + DEPTH;
  const cells = Array.from({ length: n * n }, (_, i) => {
    const r = Math.floor(i / n);
    const c = i % n;
    const cx = PAD + W / 2 + c * W + (r % 2) * (W / 2);
    const cy = PAD + R + r * 1.5 * R;
    return { cx, cy, face: hex(cx, cy, R - GAP), side: hex(cx, cy + DEPTH, R - GAP), gloss: hex(cx, cy, R - GAP - 6) };
  });
  l = { vbW, vbH, cells };
  layouts.set(n, l);
  return l;
}

/** Small mark above the letter of a special or locked cell, centred on (x, y). */
export function Badge({ kind, x, y }: { kind: Special | "lock"; x: number; y: number }) {
  const t = `translate(${x.toFixed(1)} ${y.toFixed(1)})`;
  if (kind === "gold")
    return <polygon className="badge gold" transform={t} points="0,-9 2.6,-3.2 8.6,-2.8 4,1.2 5.4,7.4 0,4 -5.4,7.4 -4,1.2 -8.6,-2.8 -2.6,-3.2" />;
  if (kind === "bomb")
    return (
      <g className="badge bomb" transform={t}>
        <circle cx="-1" cy="1.5" r="6.5" />
        <path d="M3 -3.5 L6 -7" fill="none" strokeWidth="2" strokeLinecap="round" />
        <circle className="spark" cx="7" cy="-8" r="2" />
      </g>
    );
  if (kind === "fast") return <polygon className="badge fast" transform={t} points="2,-9 -5,1 -0.5,1 -2,9 5,-1.5 0.5,-1.5" />;
  return (
    <g className="badge lock" transform={t}>
      <path d="M-4 -1 V-4 a4 4 0 0 1 8 0 V-1" fill="none" strokeWidth="2" />
      <rect x="-6" y="-1" width="12" height="9" rx="2" />
    </g>
  );
}

/** Cells that were just taken or just lost, for a one-off animation. A whole board resetting doesn't count. */
function useOwnerChanges(owners: (Seat | null)[]) {
  const prev = useRef(owners);
  const [fx, setFx] = useState<{ taken: number[]; lost: number[] }>({ taken: [], lost: [] });
  const key = owners.join(",");
  useEffect(() => {
    const before = prev.current;
    prev.current = owners;
    if (before.length !== owners.length) return;
    const taken: number[] = [];
    const lost: number[] = [];
    owners.forEach((o, i) => {
      if (o !== null && before[i] === null) taken.push(i);
      else if (o === null && before[i] !== null) lost.push(i);
    });
    if (!taken.length && lost.length !== 1) return;
    setFx({ taken, lost });
    const t = setTimeout(() => setFx({ taken: [], lost: [] }), 1000);
    return () => clearTimeout(t);
  }, [key]); // `key` stands for `owners`, whose array identity changes on every update
  return fx;
}

// Tile face and side colors for cells nobody owns yet.
const SPECIAL_SIDE: Record<Special, string> = { gold: "#c98a00", bomb: "var(--color-neutral-500)", fast: "#5b21b6" };
const SPECIAL_EDGE: Record<Special, string> = { gold: "var(--color-gold)", bomb: "var(--color-neutral-600)", fast: "var(--color-fast)" };

export function Board({ view, onPick }: { view: RoomView; onPick: (cell: number) => void }) {
  const { owners, letters, specials, locked, active, phase, winPath, current, you, size } = view;
  const { vbW, vbH, cells } = layout(size);
  const focus: Seat = phase === "question" && view.answerer !== null ? view.answerer : current;
  const cur = COLORS[focus];
  const fx = useOwnerChanges(owners);
  const live = phase !== "won"; // the bands of the player on turn glow while the match runs
  const bandH = vbH - DEPTH;

  return (
    <div className="board">
      <svg viewBox={`0 0 ${vbW.toFixed(1)} ${vbH.toFixed(1)}`} role="group" aria-label="لوحة الحروف">
        <defs>
          <linearGradient id="lw-face" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: "#ffffff" }} />
            <stop offset="1" style={{ stopColor: "var(--tile-neutral)" }} />
          </linearGradient>
          {COLORS.map((s, i) => (
            <linearGradient key={i} id={`lw-seat${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" style={{ stopColor: `color-mix(in srgb, ${s.c} 72%, white)` }} />
              <stop offset="0.55" style={{ stopColor: s.c }} />
              <stop offset="1" style={{ stopColor: s.c7 }} />
            </linearGradient>
          ))}
          <linearGradient id="lw-gold" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: "#fffbea" }} />
            <stop offset="1" style={{ stopColor: "color-mix(in srgb, var(--color-gold) 30%, white)" }} />
          </linearGradient>
          <linearGradient id="lw-bomb" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: "#f7f8fb" }} />
            <stop offset="1" style={{ stopColor: "var(--color-neutral-200)" }} />
          </linearGradient>
          <linearGradient id="lw-fast" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: "#faf7ff" }} />
            <stop offset="1" style={{ stopColor: "color-mix(in srgb, var(--color-fast) 18%, white)" }} />
          </linearGradient>
        </defs>

        {/* Goal bands: seat 1 owns the top and bottom edges, seat 0 the right and left. */}
        {[
          { seat: 1, x: PAD, y: 4, w: vbW - PAD * 2, h: 9 },
          { seat: 1, x: PAD, y: bandH - 13, w: vbW - PAD * 2, h: 9 },
          { seat: 0, x: 4, y: 50, w: 9, h: bandH - 100 },
          { seat: 0, x: vbW - 13, y: 50, w: 9, h: bandH - 100 },
        ].map((b, k) => (
          <rect
            key={k}
            className={`band${live && focus === b.seat ? " on" : ""}`}
            x={b.x}
            y={b.y}
            width={b.w}
            height={b.h}
            rx="4.5"
            fill={`url(#lw-seat${b.seat})`}
            style={{ color: COLORS[b.seat].c } as CSSProperties}
          />
        ))}

        {cells.map((g, i) => {
          const o = owners[i] as Seat | null;
          const sp = o === null ? specials[i] : null;
          const lock = o === null && locked.includes(i);
          const act = active === i && phase !== "pick" && phase !== "won";
          const pathAt = winPath.indexOf(i);
          const can = phase === "pick" && o === null && !lock && you === current;
          const face =
            o !== null ? `url(#lw-seat${o})` : act ? cur.c1 : lock ? "var(--color-neutral-100)" : sp ? `url(#lw-${sp})` : "url(#lw-face)";
          const side = o !== null ? COLORS[o].d : sp && !act ? SPECIAL_SIDE[sp] : "var(--tile-side)";
          const edge = o !== null ? COLORS[o].c7 : act ? cur.c : sp ? SPECIAL_EDGE[sp] : can ? "var(--color-neutral-400)" : "var(--color-neutral-300)";
          const cls = [
            "cell",
            can && "can",
            act && "active",
            o !== null && "owned",
            pathAt >= 0 && "on-path",
            lock && "locked",
            fx.taken.includes(i) && "taken",
            fx.lost.includes(i) && "lost",
          ]
            .filter(Boolean)
            .join(" ");
          const label = `اختر الحرف ${letters[i]}${sp ? ` (${SPECIALS[sp].name}: ${SPECIALS[sp].note})` : ""}`;
          return (
            <g
              key={i}
              className={cls}
              style={{ "--k": pathAt, "--seat": act ? cur.c : o !== null ? COLORS[o].c : undefined } as CSSProperties}
              onClick={can ? () => onPick(i) : undefined}
              onKeyDown={can ? (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onPick(i)) : undefined}
              tabIndex={can ? 0 : undefined}
              role={can ? "button" : undefined}
              aria-label={can ? label : undefined}
            >
              <polygon className="side" points={g.side} fill={side} />
              <g className="top">
                <polygon className="face" points={g.face} fill={face} stroke={edge} />
                {o !== null && <polygon className="gloss" points={g.gloss} />}
                {(sp || lock) && <Badge kind={lock ? "lock" : sp!} x={g.cx} y={g.cy - R * 0.6} />}
                <text className="glyph" x={g.cx} y={g.cy + (sp || lock ? 6 : 3)} aria-hidden>
                  {letters[i]}
                </text>
              </g>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
