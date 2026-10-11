import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Compound, StrategyDoc } from "@/data/types";
import { pct, probNoun } from "./context";
import { useTip } from "./Tip";

export const TYRE: Record<Compound, string> = {
  SOFT: "var(--tyre-soft)",
  MEDIUM: "var(--tyre-medium)",
  HARD: "var(--tyre-hard)",
  INTERMEDIATE: "var(--tyre-inter)",
  WET: "var(--tyre-wet)",
};
const INITIAL: Record<Compound, string> = {
  SOFT: "S",
  MEDIUM: "M",
  HARD: "H",
  INTERMEDIATE: "I",
  WET: "W",
};

export function StrategyView({ doc }: { doc: StrategyDoc }) {
  const tip = useTip();
  const noun = probNoun(doc.model.calibrated);
  const L = doc.race_laps;
  const opts = [...doc.options].sort(
    (a, b) => a.expected_time_delta_s - b.expected_time_delta_s,
  );
  const best = opts[0];
  const x = (lap: number) => `${((lap - 1) / L) * 100}%`;
  const w = (a: number, b: number) => `${((b - a + 1) / L) * 100}%`;

  const lifeMax = Math.max(
    0,
    ...(doc.degradation ?? []).flatMap((d) => d.tyre_life),
  );
  const degData = Array.from({ length: lifeMax }, (_, i) => {
    const row: Record<string, number> = { life: i + 1 };
    for (const d of doc.degradation ?? []) {
      const k = d.tyre_life.indexOf(i + 1);
      if (k >= 0 && d.lap_delta_s[k] != null)
        row[d.compound] = d.lap_delta_s[k]!;
    }
    return row;
  });

  return (
    <div className="space-y-6">
      {tip.node}
      <div className="flex flex-wrap items-end gap-8">
        {best && (
          <div>
            <p className="label-caps mb-1">Fastest plan</p>
            <p className="font-display text-4xl font-semibold leading-none">
              {best.stops}-stop{" "}
              {best.stints.map((s) => INITIAL[s.compound]).join("–")}
              {best.p_best != null && (
                <span className="ml-2 text-base font-normal text-muted-foreground tnum">
                  {pct(best.p_best, 0)} {noun}
                </span>
              )}
            </p>
          </div>
        )}
        <div>
          <p className="label-caps mb-1">Pit loss</p>
          <p className="font-display text-2xl font-semibold leading-none tnum">
            {doc.pit_loss_s.toFixed(1)}
            <span className="ml-1 text-sm font-normal text-muted-foreground">
              s
            </span>
          </p>
        </div>
        {doc.compounds_available && (
          <div className="flex gap-2 text-xs">
            {(
              Object.entries(doc.compounds_available) as [Compound, string][]
            ).map(([c, v]) => (
              <span key={c} className="flex items-center gap-1.5">
                <span
                  className="size-2.5 rounded-full"
                  style={{ background: TYRE[c] }}
                />
                {v}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="-mx-1 overflow-x-auto px-1">
        <div className="min-w-[560px] space-y-3">
          {opts.map((o) => (
            <div
              key={o.id}
              className="grid grid-cols-[120px_1fr_96px] items-center gap-3"
            >
              <span className="font-display text-sm font-semibold">
                {o.stops}-stop{" "}
                {o.stints.map((s) => INITIAL[s.compound]).join("–")}
              </span>
              <div className="relative h-5 rounded-sm bg-foreground/5">
                {o.stints.map((s, i) => (
                  <span
                    key={i}
                    className="absolute top-0.5 h-4 rounded-[2px] border-r-2 border-card"
                    style={{
                      left: x(s.start_lap),
                      width: w(s.start_lap, s.end_lap),
                      background: TYRE[s.compound],
                    }}
                    onPointerEnter={tip.show(
                      <>
                        {s.compound} · laps {s.start_lap}–{s.end_lap} ·{" "}
                        {s.end_lap - s.start_lap + 1} laps
                      </>,
                    )}
                    onPointerLeave={tip.hide}
                  />
                ))}
                {o.pit_windows.map((p) => (
                  <span
                    key={p.stop}
                    className="hatch pointer-events-none absolute -top-0.5 h-6 rounded-[2px] border border-foreground/40"
                    style={{
                      left: x(p.earliest_lap),
                      width: w(p.earliest_lap, p.latest_lap),
                    }}
                  />
                ))}
              </div>
              <span className="text-right text-xs tnum">
                {o.expected_time_delta_s === 0 ? (
                  <span className="text-primary">fastest</span>
                ) : (
                  `+${o.expected_time_delta_s.toFixed(1)} s`
                )}
                {o.p_best != null && (
                  <span className="ml-2 text-muted-foreground">
                    {pct(o.p_best, 0)}
                  </span>
                )}
              </span>
            </div>
          ))}
          <div className="grid grid-cols-[120px_1fr_96px] gap-3 text-[10px] text-muted-foreground tnum">
            <span />
            <div className="flex justify-between">
              <span>Lap 1</span>
              <span className="flex items-center gap-1">
                <span className="hatch inline-block h-2.5 w-4 border border-foreground/40" />
                pit window
              </span>
              <span>Lap {L}</span>
            </div>
          </div>
        </div>
      </div>

      {degData.length > 0 && (
        <div>
          <p className="label-caps mb-2">Degradation · lap delta vs tyre age</p>
          <div className="h-40">
            <ResponsiveContainer>
              <LineChart
                data={degData}
                margin={{ top: 8, right: 64, bottom: 0, left: -18 }}
              >
                <XAxis
                  dataKey="life"
                  tickLine={false}
                  axisLine={{ stroke: "var(--border)" }}
                  tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                  width={44}
                  tickFormatter={(v) => `+${v}s`}
                />
                <Tooltip
                  cursor={{ stroke: "var(--border)" }}
                  content={({ active, payload, label }) =>
                    active && payload?.length ? (
                      <div className="rounded-sm border border-border bg-popover px-2.5 py-1.5 text-xs tnum">
                        <div className="text-muted-foreground">
                          Lap {label} of stint
                        </div>
                        {payload.map((p) => (
                          <div key={String(p.dataKey)}>
                            {String(p.dataKey)}: +{Number(p.value).toFixed(2)} s
                          </div>
                        ))}
                      </div>
                    ) : null
                  }
                />
                {(doc.degradation ?? []).map((d) => (
                  <Line
                    key={d.compound}
                    dataKey={d.compound}
                    stroke={TYRE[d.compound]}
                    strokeWidth={1.75}
                    dot={false}
                    isAnimationActive={false}
                    label={({
                      x,
                      y,
                      index,
                    }: {
                      x: number;
                      y: number;
                      index: number;
                    }) =>
                      index === degData.length - 1 ? (
                        <text
                          x={x + 6}
                          y={y}
                          dy="0.35em"
                          fontSize={10}
                          fill={TYRE[d.compound]}
                          className="font-display"
                        >
                          {d.compound}
                        </text>
                      ) : (
                        <g />
                      )
                    }
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
