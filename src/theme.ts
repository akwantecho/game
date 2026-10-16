// Seat colors. The design system has no orange, so seat 1 plays in magenta (accent-2).
// c: the team ink, c7: text on light, c1: light tint, d: the dark side of a raised tile, glow: halo.
export const COLORS = [
  { c: "var(--color-accent)", c7: "var(--color-accent-700)", c1: "var(--color-accent-100)", d: "var(--deep-accent)", glow: "var(--glow-accent)" },
  { c: "var(--color-accent-2)", c7: "var(--color-accent-2-700)", c1: "var(--color-accent-2-100)", d: "var(--deep-accent-2)", glow: "var(--glow-accent-2)" },
] as const;
