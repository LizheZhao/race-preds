import { useRace } from "./context";
import { useTip } from "./Tip";
import { useWidth } from "./useWidth";

export interface BumpColumn {
  label: string;
  /** Driver ids, best first, or null when the stage has no data. Drivers missing from a column skip it. */
  order: string[] | null;
  /** Drivers drawn dashed into this column and labelled with `outLabel` (retirements, pit-lane starts). */
  out?: Set<string>;
  outLabel?: (id: string) => string;
  /** Column holds the actual outcome of the race the prediction is for. */
  result?: boolean;
  /** Column comes after the stage being viewed: drawn grey. */
  future?: boolean;
  /** Column is the viewed stage: tinted, with a primary header. */
  selected?: boolean;
  tip?: string;
}

const ROW = 22;
const TOP = 26;
const LABEL_W = 84;
const TINT_HALF = 34;
const FUTURE = "var(--input)";

/** One line per driver across the columns, at the container's real pixel width. */
export function BumpChart({ columns }: { columns: BumpColumn[] }) {
  const { drivers, colorOf, highlight, toggleHighlight } = useRace();
  const tip = useTip();
  const [ref, width] = useWidth<HTMLDivElement>();
  const last = columns[columns.length - 1]!;
  const n = Math.max(0, ...columns.map((c) => c.order?.length ?? 0));
  const W = Math.max(520, width);
  const H = TOP + n * ROW + 6;
  const step = (W - 2 * LABEL_W) / Math.max(1, columns.length - 1);
  const xs = columns.map((_, i) => LABEL_W + i * step);
  const half = Math.min(TINT_HALF, step / 2 - 2);
  const y = (i: number) => TOP + i * ROW + ROW / 2;
  const code = (id: string) => drivers.get(id)?.code ?? id;
  const ids = [
    ...new Set([
      ...(last.order ?? []),
      ...columns.flatMap((c) => c.order ?? []),
    ]),
  ].sort((a, b) => Number(highlight === a) - Number(highlight === b));
  const labelAt = (c: BumpColumn, k: number, id: string) =>
    c.out?.has(id) ? (c.outLabel?.(id) ?? "out") : `P${k + 1}`;
  const muted = (c: BumpColumn) => c.future || !c.order;
  const headFill = (c: BumpColumn) =>
    c.selected
      ? "var(--primary)"
      : muted(c)
        ? "var(--subtle)"
        : c.result
          ? "var(--result)"
          : "var(--muted-foreground)";

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
          <g key={c.label}>
            {(c.selected || c.future) && (
              <rect
                x={xs[i]! - half}
                y={2}
                width={2 * half}
                height={H - 4}
                fill={
                  c.selected
                    ? "color-mix(in oklab, var(--primary) 8%, transparent)"
                    : "color-mix(in oklab, var(--subtle) 7%, transparent)"
                }
              />
            )}
            <text
              x={xs[i]}
              y={14}
              textAnchor="middle"
              fontSize={12}
              fontWeight={600}
              className="font-display"
              fill={headFill(c)}
              opacity={muted(c) && !c.selected ? 0.65 : 1}
              onPointerEnter={c.tip ? tip.show(c.tip) : undefined}
              onPointerLeave={c.tip ? tip.hide : undefined}
              textDecoration={c.tip ? "underline dotted" : undefined}
            >
              {c.label}
            </text>
            {!c.order && (
              <>
                <line
                  x1={xs[i]}
                  x2={xs[i]}
                  y1={TOP}
                  y2={H - 6}
                  stroke={FUTURE}
                  strokeDasharray="4 4"
                />
                <text
                  transform={`rotate(-90 ${xs[i]} ${H / 2})`}
                  x={xs[i]}
                  y={H / 2}
                  dy="0.35em"
                  textAnchor="middle"
                  fontSize={11}
                  fill="var(--subtle)"
                  stroke="var(--card)"
                  strokeWidth={4}
                  paintOrder="stroke"
                >
                  no data
                </text>
              </>
            )}
          </g>
        ))}
        {ids.map((id) => {
          const on = highlight === id;
          const off = highlight != null && !on;
          const pts = columns.flatMap((c, i) => {
            const k = c.order?.indexOf(id) ?? -1;
            return k < 0 ? [] : [{ c, i, k }];
          });
          const trail = pts
            .map((p) => `${p.c.label} ${labelAt(p.c, p.k, id)}`)
            .join(" → ");
          const tone = (c: BumpColumn) =>
            c.future ? (on ? "var(--subtle)" : FUTURE) : colorOf(id);
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
                    stroke={tone(p.c)}
                    strokeWidth={on ? 3.5 : p.c.future ? 1 : 1.6}
                    opacity={off ? 0.12 : on ? 1 : 0.6}
                    strokeDasharray={p.c.out?.has(id) ? "4 3" : undefined}
                  />
                );
              })}
              {pts.map((p, j) => {
                const first = j === 0;
                const end = j === pts.length - 1;
                return (
                  <g key={p.i} opacity={off ? 0.2 : 1}>
                    <circle
                      cx={xs[p.i]}
                      cy={y(p.k)}
                      r={on ? 4.5 : p.c.future ? 2 : 3}
                      fill={tone(p.c)}
                    />
                    {(first || end) && (
                      <text
                        x={xs[p.i]! + (first ? -10 : 10)}
                        y={y(p.k)}
                        dy="0.35em"
                        textAnchor={first ? "end" : "start"}
                        fontSize={12}
                        fontWeight={on ? 700 : 500}
                        fill={
                          p.c.future && !on
                            ? "var(--subtle)"
                            : "var(--foreground)"
                        }
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
