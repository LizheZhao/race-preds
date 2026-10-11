import {
  Bar,
  ComposedChart,
  Line,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { WeatherDoc } from "@/data/types";
import { pct } from "./context";

const SESSION_HOURS: Record<string, number> = {
  FP1: 1,
  FP2: 1,
  FP3: 1,
  SQ: 1,
  S: 1,
  Q: 1,
  R: 2,
};

export function WeatherView({ weather }: { weather: WeatherDoc }) {
  const data = weather.hourly.map((h) => ({
    t: new Date(h.time_utc).getTime(),
    temp: h.air_temp_c,
    rain: h.p_rain * 100,
  }));
  const race = weather.sessions.find((s) => s.session_id === "R");
  const cl = weather.climatology;
  return (
    <div className="space-y-5">
      <div className="flex items-end gap-6">
        <div>
          <p className="label-caps mb-1">Race forecast</p>
          <p className="font-display text-4xl font-semibold leading-none tnum">
            {race?.forecast ? `${race.forecast.air_temp_c.toFixed(0)}°` : "—"}
            {race?.forecast && (
              <span className="ml-2 text-base font-normal text-muted-foreground">
                {pct(race.forecast.p_rain, 0)} rain
              </span>
            )}
          </p>
        </div>
      </div>
      <div className="-mx-1 overflow-x-auto">
        <div className="h-44 min-w-[560px]">
          <ResponsiveContainer>
            <ComposedChart
              data={data}
              margin={{ top: 18, right: 8, bottom: 0, left: 0 }}
            >
              {weather.sessions.map((s) => {
                const a = new Date(s.start_utc).getTime();
                return (
                  <ReferenceArea
                    key={s.session_id}
                    yAxisId="t"
                    x1={a}
                    x2={a + (SESSION_HOURS[s.session_id] ?? 1) * 36e5}
                    fill={
                      s.session_id === "R"
                        ? "var(--primary)"
                        : "var(--foreground)"
                    }
                    fillOpacity={s.session_id === "R" ? 0.18 : 0.07}
                    label={{
                      value: s.session_id,
                      position: "insideTop",
                      fill: "var(--muted-foreground)",
                      fontSize: 10,
                      dy: -16,
                    }}
                    ifOverflow="extendDomain"
                  />
                );
              })}
              <XAxis
                dataKey="t"
                type="number"
                scale="time"
                domain={["dataMin", "dataMax"]}
                tickLine={false}
                axisLine={{ stroke: "var(--border)" }}
                tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                tickFormatter={(t) =>
                  new Date(t).toLocaleDateString("en-GB", {
                    weekday: "short",
                    timeZone: "UTC",
                  })
                }
                ticks={data
                  .filter((d) => new Date(d.t).getUTCHours() === 12)
                  .map((d) => d.t)}
              />
              <YAxis
                yAxisId="t"
                tickLine={false}
                axisLine={false}
                tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                width={44}
                tickFormatter={(v) => `${v}°`}
                domain={["dataMin - 2", "dataMax + 2"]}
              />
              <YAxis yAxisId="r" hide domain={[0, 100]} />
              <Bar
                yAxisId="r"
                dataKey="rain"
                fill="var(--tyre-wet)"
                opacity={0.7}
                barSize={3}
              />
              <Line
                yAxisId="t"
                dataKey="temp"
                stroke="var(--foreground)"
                strokeWidth={1.5}
                dot={false}
              />
              <Tooltip
                cursor={{ stroke: "var(--border)" }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const p = payload[0]!.payload as (typeof data)[number];
                  return (
                    <div className="rounded-sm border border-border bg-popover px-2.5 py-1.5 text-xs tnum">
                      <div className="text-muted-foreground">
                        {new Date(p.t).toUTCString().slice(0, 22)} UTC
                      </div>
                      <div>
                        {p.temp.toFixed(1)}°C · {p.rain.toFixed(0)}% rain
                      </div>
                    </div>
                  );
                }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {weather.sessions.map((s) => (
          <div
            key={s.session_id}
            className="rounded-sm border border-border px-2.5 py-1.5 text-xs tnum"
          >
            <span className="mr-2 font-display font-semibold">
              {s.session_id}
            </span>
            {s.observed ? (
              <span>
                {s.observed.air_temp_c_mean.toFixed(1)}°{" "}
                <span className="text-muted-foreground">obs</span>
                {s.forecast && (
                  <span className="text-muted-foreground">
                    {" "}
                    / {s.forecast.air_temp_c.toFixed(1)}° fc
                  </span>
                )}
              </span>
            ) : s.forecast ? (
              <span>
                {s.forecast.air_temp_c.toFixed(0)}° ·{" "}
                <span className="text-muted-foreground">
                  {pct(s.forecast.p_rain, 0)} rain
                </span>
              </span>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </div>
        ))}
      </div>
      {cl && cl.seasons.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Wet in {pct(cl.wet_race_share, 0)} of races here since{" "}
          {Math.min(...cl.seasons)}. Source: {weather.source}.
        </p>
      )}
    </div>
  );
}
