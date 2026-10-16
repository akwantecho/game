import { N, type Seat } from "../shared/game";
import type { RoomView } from "../shared/protocol";
import { COLORS } from "./theme";

// Geometry from the prototype: pointy-top hexes, R=44, odd rows shifted half a cell.
const R = 44;
const W = Math.sqrt(3) * R;
const PAD = 28;
const VB_W = 475;
const VB_H = 408;

const CELLS = Array.from({ length: N * N }, (_, i) => {
  const r = Math.floor(i / N);
  const c = i % N;
  const cx = PAD + W / 2 + c * W + (r % 2) * (W / 2);
  const cy = PAD + R + r * 1.5 * R;
  const points = [0, 1, 2, 3, 4, 5]
    .map((k) => {
      const a = (Math.PI / 180) * (60 * k - 90);
      return `${(cx + (R - 2) * Math.cos(a)).toFixed(1)},${(cy + (R - 2) * Math.sin(a)).toFixed(1)}`;
    })
    .join(" ");
  return { points, lx: `${((cx / VB_W) * 100).toFixed(2)}%`, ly: `${((cy / VB_H) * 100).toFixed(2)}%` };
});

export function Board({ view, onPick }: { view: RoomView; onPick: (cell: number) => void }) {
  const { owners, letters, active, phase, winPath, current, you } = view;
  const cur = COLORS[current];
  return (
    <div className="board">
      <svg viewBox={`0 0 ${VB_W} ${VB_H}`} role="group" aria-label="لوحة الحروف">
        {/* Seat 1 owns the top and bottom edges, seat 0 the right and left. */}
        <line x1="28" y1="12" x2="447" y2="12" stroke={COLORS[1].c} strokeWidth="6" />
        <line x1="28" y1="396" x2="447" y2="396" stroke={COLORS[1].c} strokeWidth="6" />
        <line x1="10" y1="50" x2="10" y2="358" stroke={COLORS[0].c} strokeWidth="6" />
        <line x1="465" y1="50" x2="465" y2="358" stroke={COLORS[0].c} strokeWidth="6" />
        {CELLS.map((g, i) => {
          const o = owners[i] as Seat | null;
          const act = active === i && (phase === "question" || phase === "result");
          const onPath = winPath.includes(i);
          const can = phase === "pick" && o === null && you === current;
          const stroke = onPath
            ? "var(--color-text)"
            : act
              ? cur.c
              : o !== null
                ? COLORS[o].c
                : can
                  ? "var(--color-neutral-500)"
                  : "var(--color-neutral-300)";
          return (
            <polygon
              key={i}
              points={g.points}
              className={can ? "can" : undefined}
              fill={o !== null ? COLORS[o].c : act ? cur.c1 : "var(--color-surface)"}
              stroke={stroke}
              strokeWidth={onPath ? 4 : act ? 3 : 1.5}
              strokeDasharray={act && o === null ? "6 4" : "none"}
              onClick={can ? () => onPick(i) : undefined}
              onKeyDown={can ? (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onPick(i)) : undefined}
              tabIndex={can ? 0 : -1}
              role={can ? "button" : undefined}
              aria-label={can ? `اختر الحرف ${letters[i]}` : undefined}
            />
          );
        })}
      </svg>
      {CELLS.map((g, i) => (
        <div
          key={i}
          className="letter"
          aria-hidden
          style={{ left: g.lx, top: g.ly, color: owners[i] !== null ? "var(--color-bg)" : "var(--color-text)" }}
        >
          {letters[i]}
        </div>
      ))}
    </div>
  );
}
