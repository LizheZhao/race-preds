import { useRace } from "./context";
import { useTip } from "./Tip";
import { useWidth } from "./useWidth";

export interface BumpColumn {
  label: string;
  /** Driver ids, best first. Drivers missing from a column skip it. */
  order: string[];
  /** Drivers drawn dashed into this column and labelled with `outLabel` (retirements, pit-lane starts). */
  out?: Set<string>;
  outLabel?: (id: string) => string;
  /** Column holds the actual outcome of the race the prediction is for. */
  result?: boolean;
  tip?: string;
}

const ROW = 22;
const TOP = 26;
const LABEL_W = 84;

/** One line per driver across the columns, at the container's real pixel width. */
export function BumpChart({ columns }: { columns: BumpColumn[] }) {
  const { drivers, colorOf, highlight, toggleHighlight } = useRace();
  const tip = useTip();
  const [ref, width] = useWidth<HTMLDivElement>();
  const last = columns[columns.length - 1]!;
  const n = Math.max(...columns.map((c) => c.order.length));
  const W = Math.max(520, width);
  const H = TOP + n * ROW + 6;
  const xs = columns.map(
    (_, i) => LABEL_W + (i * (W - 2 * LABEL_W)) / (columns.length - 1),
  );
  const y = (i: number) => TOP + i * ROW + ROW / 2;
  const code = (id: string) => drivers.get(id)?.code ?? id;
  const ids = [
    ...new Set([...last.order, ...columns.flatMap((c) => c.order)]),
  ].sort((a, b) => Number(highlight === a) - Number(highlight === b));
  const labelAt = (c: BumpColumn, k: number, id: string) =>
    c.out?.has(id) ? (c.outLabel?.(id) ?? "out") : `P${k + 1}`;

  return (
    <div ref={ref} className="overflow-x-auto">
      {tip.node}
      <svg
        width={W}
        height={H}
        className="block"
        role="img"
        aria-label="Positions by session"
      >
        {columns.map((c, i) => (
          <text
            key={c.label}
            x={xs[i]}
            y={14}
            textAnchor={
              i === 0 ? "end" : i === columns.length - 1 ? "start" : "middle"
            }
            fontSize={12}
            fontWeight={600}
            className="font-display"
            fill={c.result ? "var(--result)" : "var(--muted-foreground)"}
            onPointerEnter={c.tip ? tip.show(c.tip) : undefined}
            onPointerLeave={c.tip ? tip.hide : undefined}
            textDecoration={c.tip ? "underline dotted" : undefined}
          >
            {c.label}
          </text>
        ))}
        {ids.map((id) => {
          const on = highlight === id;
          const off = highlight != null && !on;
          const pts = columns.flatMap((c, i) => {
            const k = c.order.indexOf(id);
            return k < 0 ? [] : [{ c, i, k }];
          });
          const trail = pts
            .map((p) => `${p.c.label} ${labelAt(p.c, p.k, id)}`)
            .join(" → ");
          return (
            <g
              key={id}
              className="cursor-pointer"
              onClick={() => toggleHighlight(id)}
              onPointerEnter={tip.show(
                <>
                  <b>{code(id)}</b> {trail}
                </>,
              )}
              onPointerLeave={tip.hide}
            >
              {pts.slice(1).map((p, j) => {
                const q = pts[j]!;
                const mx = (xs[q.i]! + xs[p.i]!) / 2;
                return (
                  <path
                    key={p.i}
                    d={`M${xs[q.i]},${y(q.k)} C${mx},${y(q.k)} ${mx},${y(p.k)} ${xs[p.i]},${y(p.k)}`}
                    fill="none"
                    stroke={colorOf(id)}
                    strokeWidth={on ? 3.5 : 1.6}
                    opacity={off ? 0.12 : on ? 1 : 0.6}
                    strokeDasharray={p.c.out?.has(id) ? "4 3" : undefined}
                  />
                );
              })}
              {pts.map((p) => {
                const first = p.i === 0;
                const end = p.i === columns.length - 1;
                return (
                  <g key={p.i} opacity={off ? 0.2 : 1}>
                    <circle
                      cx={xs[p.i]}
                      cy={y(p.k)}
                      r={on ? 4.5 : 3}
                      fill={colorOf(id)}
                    />
                    {(first || end) && (
                      <text
                        x={xs[p.i]! + (first ? -10 : 10)}
                        y={y(p.k)}
                        dy="0.35em"
                        textAnchor={first ? "end" : "start"}
                        fontSize={12}
                        fontWeight={on ? 700 : 500}
                        fill="var(--foreground)"
                        className="tnum"
                      >
                        {first
                          ? `${code(id)}  ${labelAt(p.c, p.k, id)}`
                          : `${labelAt(p.c, p.k, id)}  ${code(id)}`}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
