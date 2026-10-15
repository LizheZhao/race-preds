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
