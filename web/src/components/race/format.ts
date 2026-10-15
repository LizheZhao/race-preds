export const plural = (n: number, word: string) =>
  `${n} ${word}${n === 1 ? "" : "s"}`;

export function lapFmt(s: number | null | undefined) {
  return s == null
    ? "—"
    : `${Math.floor(s / 60)}:${(s % 60).toFixed(3).padStart(6, "0")}`;
}

/** The position where cumulative probability first reaches half of the total. */
export function medianPosition(probs: number[]) {
  const total = probs.reduce((a, b) => a + b, 0);
  let acc = 0;
  for (let k = 0; k < probs.length; k++) {
    acc += probs[k]!;
    if (acc >= total / 2) return k + 1;
  }
  return probs.length;
}

/** Places gained from the grid slot to the finishing position; positive means a gain. */
export const placesGained = (from: number | null, to: number | null) =>
  from == null || to == null ? null : from - to;

export function gainLabel(g: number | null) {
  if (g == null) return "—";
  return g === 0 ? "·" : `${g > 0 ? "▲" : "▼"}${Math.abs(g)}`;
}

export const gainClass = (g: number | null) =>
  g == null || g === 0
    ? "text-muted-foreground"
    : g > 0
      ? "text-foreground"
      : "text-primary";

const TEAM_ABBR: Record<string, string> = {
  mercedes: "MER",
  ferrari: "FER",
  mclaren: "MCL",
  red_bull: "RBR",
  rb: "RB",
  alpine: "ALP",
  haas: "HAA",
  audi: "AUD",
  williams: "WIL",
  aston_martin: "AMR",
  cadillac: "CAD",
};
export const teamAbbr = (id: string, name: string) =>
  TEAM_ABBR[id] ?? name.slice(0, 3).toUpperCase();

export interface BoxStats {
  n: number;
  q1: number;
  median: number;
  q3: number;
  /** Whisker ends: the furthest laps within 1.5 × IQR of the box. */
  low: number;
  high: number;
  sd: number;
  outliers: number[];
}

/** Tukey box-plot summary of lap times; null below three laps. */
export function boxStats(laps: number[]): BoxStats | null {
  if (laps.length < 3) return null;
  const v = [...laps].sort((a, b) => a - b);
  const q = (p: number) => {
    const i = (v.length - 1) * p;
    const lo = Math.floor(i);
    return v[lo]! + (v[Math.ceil(i)]! - v[lo]!) * (i - lo);
  };
  const q1 = q(0.25),
    q3 = q(0.75),
    iqr = q3 - q1;
  const inside = v.filter((x) => x >= q1 - 1.5 * iqr && x <= q3 + 1.5 * iqr);
  const mean = v.reduce((s, x) => s + x, 0) / v.length;
  const sd = Math.sqrt(
    v.reduce((s, x) => s + (x - mean) ** 2, 0) / (v.length - 1),
  );
  return {
    n: v.length,
    q1,
    median: q(0.5),
    q3,
    low: inside[0]!,
    high: inside[inside.length - 1]!,
    sd,
    outliers: v.filter((x) => x < inside[0]! || x > inside[inside.length - 1]!),
  };
}
