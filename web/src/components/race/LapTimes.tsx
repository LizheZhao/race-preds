import type { ResultsDoc } from "@/data/types";
import { classOrder } from "./compare";
import { useRace } from "./context";
import { boxStats, lapFmt } from "./format";
import { useTip } from "./Tip";
import { useWidth } from "./useWidth";

const ROW = 22;
const TOP = 22;
const LEFT = 120;
const RIGHT = 230;

/** Clean green-flag race laps per driver as box plots, in finishing order. */
export function LapTimes({ doc }: { doc: ResultsDoc }) {
  const { drivers, colorOf, highlight, toggleHighlight } = useRace();
  const tip = useTip();
  const [ref, width] = useWidth<HTMLDivElement>();
  const laps = new Map(
    (doc.race_pace ?? []).map((p) => [p.driver_id, p.lap_times_s]),
  );
  const { order, out } = classOrder(doc.race ?? []);
  const rows = (order.length ? order : [...laps.keys()]).map((id) => ({
    id,
    stats: boxStats(laps.get(id) ?? []),
    n: laps.get(id)?.length ?? 0,
  }));
  const shown = rows.flatMap((r) => (r.stats ? [r.stats] : []));
  if (!shown.length) return null;
  const vmin = Math.floor(Math.min(...shown.map((s) => s.low)));
  const vmax = Math.ceil(Math.max(...shown.map((s) => s.high)) + 0.5);
  const best = Math.min(...shown.map((s) => s.median));
  const W = Math.max(640, width);
  const H = TOP + rows.length * ROW + 24;
  const x = (v: number) =>
    LEFT + ((Math.min(v, vmax) - vmin) / (vmax - vmin)) * (W - LEFT - RIGHT);
  const ticks = Array.from({ length: vmax - vmin + 1 }, (_, i) => vmin + i);

  return (
    <div ref={ref} className="overflow-x-auto">
      {tip.node}
      <svg
        width={W}
        height={H}
        className="block"
        role="img"
        aria-label="Race lap times by driver"
      >
        {ticks.map((v) => (
          <g key={v}>
            <line
              x1={x(v)}
              x2={x(v)}
              y1={TOP - 4}
              y2={H - 22}
              stroke="var(--border)"
            />
            <text
              x={x(v)}
              y={H - 8}
              textAnchor="middle"
              fontSize={10}
              fill="var(--muted-foreground)"
              className="tnum"
            >
              {lapFmt(v).slice(0, 4)}
            </text>
          </g>
        ))}
        {[
          ["MEDIAN · GAP", W - RIGHT + 16, "start"],
          ["STD", W - 46, "end"],
          ["LAPS", W - 6, "end"],
        ].map(([label, lx, anchor]) => (
          <text
            key={label}
            x={lx}
            y={14}
            textAnchor={anchor as "start" | "end"}
            fontSize={10}
            letterSpacing={1}
            fill="var(--muted-foreground)"
            className="font-display"
          >
            {label}
          </text>
        ))}
        {rows.map(({ id, stats, n }, i) => {
          const yc = TOP + i * ROW + ROW / 2;
          const on = highlight === id;
          const c = colorOf(id);
          const code = drivers.get(id)?.code ?? id;
          return (
            <g
              key={id}
              className="cursor-pointer"
              opacity={highlight != null && !on ? 0.25 : 1}
              onClick={() => toggleHighlight(id)}
            >
              <rect
                x={0}
                y={yc - ROW / 2}
                width={W}
                height={ROW}
                fill={
                  on
                    ? "color-mix(in oklab, var(--foreground) 5%, transparent)"
                    : "transparent"
                }
              />
              <text
                x={8}
                y={yc}
                dy="0.35em"
                fontSize={11}
                fill="var(--muted-foreground)"
                className="tnum"
              >
                {out.has(id) ? "DNF" : `P${i + 1}`}
              </text>
              <rect x={42} y={yc - 7} width={3} height={14} rx={1.5} fill={c} />
              <text
                x={52}
                y={yc}
                dy="0.35em"
                fontSize={13}
                fontWeight={600}
                fill="var(--foreground)"
                className="font-display"
              >
                {code}
              </text>
              {stats ? (
                <>
                  <line
                    x1={x(stats.low)}
                    x2={x(stats.high)}
                    y1={yc}
                    y2={yc}
                    stroke={c}
                    strokeWidth={1.2}
                  />
                  <rect
                    x={x(stats.q1)}
                    y={yc - 6}
                    width={Math.max(2, x(stats.q3) - x(stats.q1))}
                    height={12}
                    rx={2}
                    fill={c}
                    fillOpacity={0.35}
                    stroke={c}
                    onPointerEnter={tip.show(
                      <>
                        <b>{code}</b> · {stats.n} clean laps
                        <br />
                        median {lapFmt(stats.median)} · middle half{" "}
                        {lapFmt(stats.q1)}–{lapFmt(stats.q3)}
                        <br />
                        std {stats.sd.toFixed(2)} s
                      </>,
                    )}
                    onPointerLeave={tip.hide}
                  />
                  <line
                    x1={x(stats.median)}
                    x2={x(stats.median)}
                    y1={yc - 6}
                    y2={yc + 6}
                    stroke="var(--foreground)"
                    strokeWidth={2}
                  />
                  {stats.outliers
                    .filter((v) => v <= vmax)
                    .map((v, k) => (
                      <circle
                        key={k}
                        cx={x(v)}
                        cy={yc}
                        r={1.8}
                        fill="var(--muted-foreground)"
                      />
                    ))}
                  <text
                    x={W - RIGHT + 16}
                    y={yc}
                    dy="0.35em"
                    fontSize={12}
                    fill="var(--foreground)"
                    className="tnum"
                  >
                    {lapFmt(stats.median)}
                  </text>
                  <text
                    x={W - RIGHT + 76}
                    y={yc}
                    dy="0.35em"
                    fontSize={11}
                    fill="var(--muted-foreground)"
                    className="tnum"
                  >
                    +{(stats.median - best).toFixed(2)}
                  </text>
                  <text
                    x={W - 46}
                    y={yc}
                    dy="0.35em"
                    textAnchor="end"
                    fontSize={12}
                    fill="var(--foreground)"
                    className="tnum"
                  >
                    {stats.sd.toFixed(2)}s
                  </text>
                </>
              ) : (
                <text
                  x={LEFT}
                  y={yc}
                  dy="0.35em"
                  fontSize={11}
                  fill="var(--muted-foreground)"
                >
                  too few clean laps to plot
                </text>
              )}
              <text
                x={W - 6}
                y={yc}
                dy="0.35em"
                textAnchor="end"
                fontSize={11}
                fill="var(--muted-foreground)"
                className="tnum"
              >
                {n}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Clean green-flag race laps. Box = middle half of a driver's laps, white
        tick = median, whiskers = 1.5 × IQR. A narrow box means consistent pace.
      </p>
    </div>
  );
}
