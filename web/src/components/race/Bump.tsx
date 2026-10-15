import { useEffect, useRef, useState } from "react";
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
  // Fit the container, never wider than the natural size and never stretched.
  const box = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState(9999);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setAvail(e!.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const first = columns[0]!;
  const last = columns[columns.length - 1]!;
  const ids = [...new Set(columns.flatMap((c) => c.order))];
  const n = Math.max(...columns.map((c) => c.order.length));

  // Drawn at its own pixel size, never stretched: type stays at reading size on any width.
  const narrow = avail < 480;
  const H = 24 * n + 36,
    W = Math.min(
      Math.max(560, 150 * (columns.length - 1) + 220),
      Math.max(300, avail),
    ),
    L = narrow ? 82 : 104,
    R = W - (narrow ? 96 : 110);
  const x = (i: number) => L + ((R - L) * i) / (columns.length - 1);
  const y = (rank: number) => 34 + ((rank - 1) / Math.max(1, n - 1)) * (H - 52);
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
    <div ref={box} className="min-w-0">
      {tip.node}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        className="block max-w-none"
        role="img"
        aria-label={`Ranks by ${columns.map((c) => c.label).join(", ")}`}
      >
        {columns.map((c, i) => (
          <g key={c.label}>
            <text
              x={x(i)}
              y={12}
              textAnchor="middle"
              fontSize={12}
              fontWeight={700}
              letterSpacing="0.08em"
              fill="var(--muted-foreground)"
              style={{ textTransform: "uppercase" }}
            >
              {c.label}
            </text>
            <line
              x1={x(i)}
              x2={x(i)}
              y1={22}
              y2={H - 12}
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
                    strokeOpacity={dim ? 0.3 : 1}
                    strokeWidth={strong || highlight === id ? 3 : 1.5}
                    strokeDasharray={p.c.out?.has(id) ? "3 3" : undefined}
                  />
                );
              })}
              {points.map((p) => (
                <circle
                  key={p.i}
                  cx={x(p.i)}
                  cy={y(p.r)}
                  r={3.5}
                  fill={colorOf(id)}
                  fillOpacity={dim ? 0.35 : 1}
                  stroke="var(--card)"
                  strokeWidth={1}
                />
              ))}
              {a != null && (
                <text
                  x={L - 8}
                  y={y(a)}
                  dy="0.35em"
                  textAnchor="end"
                  fontSize={13}
                  fontWeight={strong ? 800 : 500}
                  fill={dim ? "var(--muted-foreground)" : "var(--foreground)"}
                  className="tnum"
                >
                  {code} {label(first, a)}
                </text>
              )}
              {b != null && (
                <text
                  x={R + 8}
                  y={y(b)}
                  dy="0.35em"
                  fontSize={13}
                  fontWeight={strong ? 800 : 500}
                  fill={
                    last.out?.has(id)
                      ? "var(--flag-red)"
                      : dim
                        ? "var(--muted-foreground)"
                        : "var(--foreground)"
                  }
                  className="tnum"
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
