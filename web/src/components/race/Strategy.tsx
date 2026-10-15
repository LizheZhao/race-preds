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
// Lines need contrast on the laminate: the white hard compound draws in ink.
const LINE: Record<Compound, string> = {
  SOFT: "var(--tyre-soft)",
  MEDIUM: "#d9a400",
  HARD: "var(--foreground)",
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

  const lastIdx = (c: Compound) => {
    for (let i = degData.length - 1; i >= 0; i--)
      if (degData[i]![c] != null) return i;
    return -1;
  };

  return (
    <div className="space-y-6">
      {tip.node}
      <p className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
        {best && (
          <span>
            Fastest:{" "}
            <span className="font-bold text-foreground">
              {best.stops}-stop{" "}
              {best.stints.map((s) => INITIAL[s.compound]).join("–")}
            </span>
            {best.p_best != null && ` · ${pct(best.p_best, 0)} ${noun}`}
          </span>
        )}
        <span className="tnum">
          Pit loss{" "}
          <span className="font-bold text-foreground">
            {doc.pit_loss_s.toFixed(1)} s
          </span>
        </span>
        {doc.compounds_available &&
          (Object.entries(doc.compounds_available) as [Compound, string][]).map(
            ([c, v]) => (
              <span key={c} className="flex items-center gap-1.5">
                <span
                  className="size-3 rounded-full border border-foreground"
                  style={{ background: TYRE[c] }}
                />
                {v}
              </span>
            ),
          )}
      </p>

      <div>
        <div className="space-y-3">
          {opts.map((o) => (
            <div
              key={o.id}
              className="grid grid-cols-[84px_1fr_52px] sm:grid-cols-[120px_1fr_96px] items-center gap-3"
            >
              <span className="cond text-sm font-extrabold">
                {o.stops}-stop{" "}
                {o.stints.map((s) => INITIAL[s.compound]).join("–")}
              </span>
              <div className="relative h-6 border border-foreground bg-background">
                {o.stints.map((s, i) => (
                  <span
                    key={i}
                    className="absolute inset-y-0 border-r border-foreground last:border-r-0"
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
                    className="hatch pointer-events-none absolute -inset-y-1 border border-dashed border-foreground/70"
                    style={{
                      left: x(p.earliest_lap),
                      width: w(p.earliest_lap, p.latest_lap),
                    }}
                  />
                ))}
              </div>
              <span className="text-right text-xs tnum">
                {o.expected_time_delta_s === 0 ? (
                  <span className="font-bold">Fastest</span>
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
          <div className="grid grid-cols-[84px_1fr_52px] sm:grid-cols-[120px_1fr_96px] gap-3 text-xs text-muted-foreground tnum">
            <span />
            <div className="flex justify-between">
              <span>Lap 1</span>
              <span className="flex items-center gap-1">
                <span className="hatch inline-block h-3 w-5 border border-dashed border-foreground/70" />
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
          <div className="h-48">
            <ResponsiveContainer>
              <LineChart
                data={degData}
                margin={{ top: 14, right: 72, bottom: 0, left: 4 }}
              >
                <XAxis
                  dataKey="life"
                  tickLine={false}
                  axisLine={{ stroke: "var(--border)" }}
                  tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                  minTickGap={16}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                  width={52}
                  tickFormatter={(v: number) => `+${v.toFixed(1)}s`}
                />
                <Tooltip
                  cursor={{ stroke: "var(--border)" }}
                  content={({ active, payload, label }) =>
                    active && payload?.length ? (
                      <div className="border border-foreground bg-popover px-2.5 py-1.5 text-xs tnum">
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
                    stroke={LINE[d.compound]}
                    strokeWidth={2.25}
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
                      // Each compound is labelled at the end of its own line, not the chart's.
                      index === lastIdx(d.compound) && y != null ? (
                        <text
                          x={x + 6}
                          y={y}
                          dy="0.35em"
                          fontSize={12}
                          fontWeight={700}
                          fill={LINE[d.compound]}
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
