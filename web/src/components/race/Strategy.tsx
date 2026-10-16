import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { CSSProperties } from "react";
import type { Compound, StrategyDoc } from "@/data/types";
import { useTip } from "./Tip";

export const TYRE: Record<Compound, string> = {
  SOFT: "var(--tyre-soft)",
  MEDIUM: "var(--tyre-medium)",
  HARD: "var(--tyre-hard)",
  INTERMEDIATE: "var(--tyre-inter)",
  WET: "var(--tyre-wet)",
};
/** Fill for a compound swatch or stint. The hard tyre is white, so it carries an ink edge on the white card. */
export const tyreFill = (c: Compound): CSSProperties => ({
  background: TYRE[c],
  boxShadow:
    c === "HARD"
      ? "inset 0 0 0 1px color-mix(in oklab, var(--foreground) 55%, transparent)"
      : undefined,
});

/** Stroke for a compound drawn as a line: white would vanish, so the hard tyre is drawn in ink. */
const TYRE_LINE: Record<Compound, string> = {
  ...TYRE,
  HARD: "var(--foreground)",
};

export const INITIAL: Record<Compound, string> = {
  SOFT: "S",
  MEDIUM: "M",
  HARD: "H",
  INTERMEDIATE: "I",
  WET: "W",
};

const NAME: Record<Compound, string> = {
  SOFT: "Soft",
  MEDIUM: "Medium",
  HARD: "Hard",
  INTERMEDIATE: "Inter",
  WET: "Wet",
};

/** Compound colours, with the Pirelli C-number when the document carries one. */
export function CompoundLegend({ doc }: { doc: StrategyDoc }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
      {(["SOFT", "MEDIUM", "HARD"] as const).map((c) => (
        <span key={c} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full" style={tyreFill(c)} />
          {doc.compounds_available?.[c] ? (
            <>
              <span className="font-semibold">
                {doc.compounds_available[c]}
              </span>
              <span className="text-muted-foreground">{NAME[c]}</span>
            </>
          ) : (
            NAME[c]
          )}
        </span>
      ))}
    </div>
  );
}

const planName = (o: StrategyDoc["options"][number]) =>
  `${o.stops}-stop ${o.stints.map((s) => INITIAL[s.compound]).join("–")}`;

export function StrategyView({ doc }: { doc: StrategyDoc }) {
  const tip = useTip();
  const L = doc.race_laps;
  const opts = [...doc.options].sort(
    (a, b) => a.expected_time_delta_s - b.expected_time_delta_s,
  );
  const best = opts[0];
  const x = (lap: number) => ((lap - 1) / L) * 100;

  return (
    <div>
      {tip.node}
      <div className="mb-4 flex flex-wrap items-end gap-x-8 gap-y-3">
        {best && (
          <div>
            <p className="label-caps mb-1.5">Fastest plan</p>
            <p className="font-display text-[30px] font-semibold leading-none">
              {planName(best)}
            </p>
          </div>
        )}
        <div>
          <p className="label-caps mb-1.5">Pit loss</p>
          <p className="font-display text-[30px] font-semibold leading-none tnum">
            {doc.pit_loss_s.toFixed(1)}
            <span className="ml-1 text-sm font-normal text-muted-foreground">
              s
            </span>
          </p>
        </div>
      </div>

      <div>
        {opts.map((o, i) => (
          <div
            key={o.id}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3.5 gap-y-2 pt-1.5 pb-6 sm:h-[46px] sm:grid-cols-[110px_minmax(0,1fr)_72px] sm:pb-0"
          >
            <span className="font-display text-sm font-semibold leading-4">
              {planName(o)}
            </span>
            <div className="relative col-span-2 row-start-2 h-4 sm:col-span-1 sm:col-start-2 sm:row-start-1">
              {o.stints.map((s, k) => (
                <span
                  key={k}
                  className="absolute inset-y-0"
                  style={{
                    left: `${x(s.start_lap)}%`,
                    width: `${x(s.end_lap + 1) - x(s.start_lap)}%`,
                    ...tyreFill(s.compound),
                  }}
                  onPointerEnter={tip.show(
                    <>
                      {s.compound} · laps {s.start_lap}–{s.end_lap}
                    </>,
                  )}
                  onPointerLeave={tip.hide}
                />
              ))}
              {o.pit_windows.map((p) => (
                <span key={p.stop}>
                  <span
                    className="hatch absolute -inset-y-1 border border-foreground/45"
                    style={{
                      left: `${x(p.earliest_lap)}%`,
                      width: `${x(p.latest_lap + 1) - x(p.earliest_lap)}%`,
                    }}
                    onPointerEnter={tip.show(
                      <>
                        Stop {p.stop}: laps {p.earliest_lap}–{p.latest_lap}
                      </>,
                    )}
                    onPointerLeave={tip.hide}
                  />
                  <span
                    className="pointer-events-none absolute top-[22px] -translate-x-1/2 whitespace-nowrap text-[11px] text-muted-foreground tnum"
                    style={{
                      left: `${(x(p.earliest_lap) + x(p.latest_lap + 1)) / 2}%`,
                    }}
                  >
                    L{p.earliest_lap}–{p.latest_lap}
                  </span>
                </span>
              ))}
            </div>
            <span className="col-start-2 row-start-1 text-right text-sm leading-4 tnum sm:col-start-3">
              {i === 0 ? (
                <span className="font-bold">Fastest</span>
              ) : (
                `+${o.expected_time_delta_s.toFixed(1)} s`
              )}
            </span>
          </div>
        ))}
        <div className="mt-0.5 flex items-center justify-between text-[11px] text-muted-foreground tnum sm:mr-[86px] sm:ml-[124px]">
          <span>Lap 1</span>
          <span className="flex items-center gap-1.5">
            <span className="hatch inline-block h-3 w-3 border border-foreground/45" />
            pit window
          </span>
          <span>Lap {L}</span>
        </div>
      </div>

      <Degradation doc={doc} />
    </div>
  );
}

function Degradation({ doc }: { doc: StrategyDoc }) {
  const curves = doc.degradation ?? [];
  const lifeMax = Math.max(0, ...curves.flatMap((d) => d.tyre_life));
  if (lifeMax === 0) return null;
  const data = Array.from({ length: lifeMax }, (_, i) => {
    const row: Record<string, number> = { life: i + 1 };
    for (const d of curves) {
      const k = d.tyre_life.indexOf(i + 1);
      if (k >= 0 && d.lap_delta_s[k] != null)
        row[d.compound] = d.lap_delta_s[k]!;
    }
    return row;
  });
  const endIndex = (c: Compound) =>
    data.reduce((last, row, i) => (row[c] != null ? i : last), -1);

  return (
    <div className="mt-5">
      <p className="label-caps mb-2">
        Degradation · lap delta vs tyre age in laps
      </p>
      <div className="h-[210px]">
        <ResponsiveContainer>
          <LineChart
            data={data}
            margin={{ top: 10, right: 58, bottom: 0, left: -6 }}
          >
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis
              dataKey="life"
              tickLine={false}
              axisLine={false}
              tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
              width={44}
              tickFormatter={(v: number) => `+${v}s`}
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
            {curves.map((d) => (
              <Line
                key={d.compound}
                type="monotone"
                dataKey={d.compound}
                stroke={TYRE_LINE[d.compound]}
                strokeWidth={2}
                dot={false}
                connectNulls
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
                  index === endIndex(d.compound) ? (
                    <text
                      key={d.compound}
                      x={x + 6}
                      y={y}
                      dy="0.35em"
                      fontSize={11}
                      fontWeight={600}
                      fill="var(--foreground)"
                    >
                      {NAME[d.compound]}
                    </text>
                  ) : (
                    <g key={`${d.compound}${index}`} />
                  )
                }
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
