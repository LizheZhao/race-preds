import { useRace } from "./context";
import { useTip } from "./Tip";

export interface BumpColumn {
  label: string;
  /** Driver ids, best first. Drivers missing from a column skip it. */
  order: string[];
  /** Drivers drawn dashed and labelled with `outLabel` in this column (e.g. retirements). */
  out?: Set<string>;
  outLabel?: (id: string) => string;
}

/** Ranks per column joined by one line per driver; the biggest overall movers stand out. */
export function BumpChart({ columns }: { columns: BumpColumn[] }) {
  const { drivers, colorOf, highlight, toggleHighlight } = useRace();
  const tip = useTip();
  const first = columns[0]!;
  const last = columns[columns.length - 1]!;
  const ids = [...new Set(columns.flatMap((c) => c.order))];
  const n = Math.max(...columns.map((c) => c.order.length));

  const H = 22 * n + 30,
    W = Math.max(520, 140 * (columns.length - 1) + 180),
    L = 90,
    R = W - 90;
  const x = (i: number) => L + ((R - L) * i) / (columns.length - 1);
  const y = (rank: number) => 20 + ((rank - 1) / Math.max(1, n - 1)) * (H - 40);
  const rank = (c: BumpColumn, id: string) => {
    const i = c.order.indexOf(id);
    return i < 0 ? null : i + 1;
  };

  const change = (id: string) => {
    const a = rank(first, id),
      b = rank(last, id);
    return a == null || b == null ? 0 : a - b;
  };
  const big =
    ids.map((id) => Math.abs(change(id))).sort((a, b) => b - a)[
      Math.min(4, ids.length - 1)
    ] ?? 0;

  return (
    <div className="-mx-1 overflow-x-auto">
      {tip.node}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full min-w-[480px]"
        style={{ height: "auto" }}
      >
        {columns.map((c, i) => (
          <g key={c.label}>
            <text
              x={x(i)}
              y={10}
              textAnchor="middle"
              className="font-display"
              fontSize={10}
              fill="var(--muted-foreground)"
            >
              {c.label}
            </text>
            <line
              x1={x(i)}
              x2={x(i)}
              y1={16}
              y2={H - 14}
              stroke="var(--border)"
            />
          </g>
        ))}
        {ids.map((id) => {
          const code = drivers.get(id)?.code ?? id;
          const d = change(id);
          const strong = Math.abs(d) >= big && Math.abs(d) > 0;
          const dim = highlight ? highlight !== id : !strong;
          const points = columns
            .map((c, i) => ({ c, i, r: rank(c, id) }))
            .filter(
              (p): p is { c: BumpColumn; i: number; r: number } => p.r != null,
            );
          const label = (c: BumpColumn, r: number) =>
            c.out?.has(id) ? (c.outLabel?.(id) ?? "out") : `P${r}`;
          const a = rank(first, id),
            b = rank(last, id);
          return (
            <g
              key={id}
              onClick={() => toggleHighlight(id)}
              className="cursor-pointer"
              onPointerEnter={tip.show(
                <>
                  {code}:{" "}
                  {points
                    .map((p) => `${p.c.label} ${label(p.c, p.r)}`)
                    .join(" → ")}
                </>,
              )}
              onPointerLeave={tip.hide}
              opacity={dim ? 0.25 : 1}
            >
              {points.slice(1).map((p, k) => {
                const q = points[k]!;
                return (
                  <line
                    key={p.i}
                    x1={x(q.i)}
                    y1={y(q.r)}
                    x2={x(p.i)}
                    y2={y(p.r)}
                    stroke={colorOf(id)}
                    strokeWidth={strong || highlight === id ? 2.5 : 1.25}
                    strokeDasharray={p.c.out?.has(id) ? "3 3" : undefined}
                  />
                );
              })}
              {points.map((p) => (
                <circle
                  key={p.i}
                  cx={x(p.i)}
                  cy={y(p.r)}
                  r={3}
                  fill={colorOf(id)}
                />
              ))}
              {a != null && (
                <text
                  x={L - 8}
                  y={y(a)}
                  dy="0.35em"
                  textAnchor="end"
                  fontSize={10}
                  fill="var(--foreground)"
                  className="font-display tnum"
                >
                  {code} {label(first, a)}
                </text>
              )}
              {b != null && (
                <text
                  x={R + 8}
                  y={y(b)}
                  dy="0.35em"
                  fontSize={10}
                  fill="var(--foreground)"
                  className="font-display tnum"
                >
                  {label(last, b)} {code}
                  {strong ? ` ${d > 0 ? "▲" : "▼"}${Math.abs(d)}` : ""}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
