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
      <p className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 bg-foreground" />
          Air temperature
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-1.5 bg-tyre-wet" />
          Rain chance
        </span>
        {!race?.observed && !race?.forecast && (
          <span>
            The race forecast opens once the race is inside the forecast window.
          </span>
        )}
      </p>
      <div>
        <div className="h-44">
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
                    fill="var(--foreground)"
                    fillOpacity={s.session_id === "R" ? 0.16 : 0.06}
                    label={{
                      value: s.session_id,
                      position: "insideTop",
                      fill: "var(--foreground)",
                      fontSize: 11,
                      fontWeight: 700,
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
                tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
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
                tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                width={44}
                tickFormatter={(v) => `${v}°`}
                domain={["dataMin - 2", "dataMax + 2"]}
              />
              <YAxis yAxisId="r" hide domain={[0, 100]} />
              <Bar
                yAxisId="r"
                dataKey="rain"
                fill="var(--tyre-wet)"
                opacity={0.55}
                barSize={3}
              />
              <Line
                yAxisId="t"
                dataKey="temp"
                stroke="var(--foreground)"
                strokeWidth={2}
                dot={false}
              />
              <Tooltip
                cursor={{ stroke: "var(--border)" }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const p = payload[0]!.payload as (typeof data)[number];
                  return (
                    <div className="border border-foreground bg-popover px-2.5 py-1.5 text-xs tnum">
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
      <div className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] border-t border-l border-border">
        {weather.sessions.map((s) => (
          <div
            key={s.session_id}
            className="border-r border-b border-border px-3 py-2 text-sm tnum"
          >
            <span className="cond mr-2 font-extrabold">{s.session_id}</span>
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
