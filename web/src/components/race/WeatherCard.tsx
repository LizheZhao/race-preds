import type { WeatherDoc } from "@/data/types";
import { pct } from "./context";
import { useTip } from "./Tip";

type Session = WeatherDoc["sessions"][number];

const HOURS: Record<string, number> = { SQ: 0.75, R: 2 };
const NAME: Record<string, string> = {
  FP1: "Practice 1",
  FP2: "Practice 2",
  FP3: "Practice 3",
  SQ: "Sprint Quali",
  S: "Sprint",
  Q: "Qualifying",
  R: "Race",
};
const hoursOf = (id: string) => HOURS[id] ?? 1;

/** Observed track temperature of a session; `min` is null when the sensor data had none. */
function trackTemp(s: Session): { min: number | null; max: number } | null {
  return s.observed
    ? {
        min: s.observed.track_temp_c_min ?? null,
        max: s.observed.track_temp_c_max,
      }
    : null;
}
const trackText = (t: ReturnType<typeof trackTemp>) =>
  t
    ? t.min == null
      ? `${t.max.toFixed(1)}°C`
      : `${t.min.toFixed(1)}–${t.max.toFixed(1)}°C`
    : "—";

export function WeatherLegend({ hasTrack }: { hasTrack: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className="h-0.5 w-3 bg-foreground" />
        Air °C
      </span>
      {hasTrack && (
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-1 rounded-full bg-warning" />
          Track °C
        </span>
      )}
      <span className="flex items-center gap-1.5">
        <span className="size-3 bg-tyre-wet" />
        Rain chance %
      </span>
    </div>
  );
}

const W = 1340,
  H = 300,
  PL = 40,
  PR = 44,
  PT = 26,
  PB = 26;

export function WeatherView({ weather }: { weather: WeatherDoc }) {
  const tip = useTip();
  const hr = weather.hourly.map((h) => ({
    t: new Date(h.time_utc).getTime(),
    a: h.air_temp_c,
    r: h.p_rain * 100,
  }));
  const sess = weather.sessions.map((s) => ({
    s,
    t: new Date(s.start_utc).getTime(),
    track: trackTemp(s),
  }));
  const race = sess.find((x) => x.s.session_id === "R");
  const cl = weather.climatology;
  if (hr.length < 2) return null;

  const t0 = hr[0]!.t,
    t1 = hr[hr.length - 1]!.t;
  const temps = [
    ...hr.map((h) => h.a),
    ...sess.flatMap((x) =>
      x.track ? [x.track.min ?? x.track.max, x.track.max] : [],
    ),
  ];
  const lo = Math.floor(Math.min(...temps) / 5) * 5;
  const hi = Math.ceil(Math.max(...temps) / 5) * 5;
  const gx = (t: number) => PL + ((t - t0) / (t1 - t0)) * (W - PL - PR);
  const gyT = (v: number) => PT + (1 - (v - lo) / (hi - lo)) * (H - PT - PB);
  const gyR = (p: number) => PT + (1 - p / 100) * (H - PT - PB);
  const bw = Math.max(2, ((W - PL - PR) / hr.length) * 0.6);
  const ticks: number[] = [];
  for (let v = lo; v <= hi; v += 5) ticks.push(v);
  const o = race?.s.observed;
  const f = race?.s.forecast;

  return (
    <div>
      {tip.node}
      {(o || f) && (
        <div className="mb-2">
          <p className="label-caps mb-1.5">{o ? "Race" : "Race forecast"}</p>
          <p className="font-display text-[30px] font-semibold leading-none tnum">
            {(o ? o.air_temp_c_mean : f!.air_temp_c).toFixed(0)}°C{" "}
            <span className="text-base font-normal text-muted-foreground">
              air
            </span>
            {o && (
              <>
                {" "}
                <span className="text-warning">
                  {o.track_temp_c_min != null &&
                    `${o.track_temp_c_min.toFixed(0)}–`}
                  {o.track_temp_c_max.toFixed(0)}°C
                </span>{" "}
                <span className="text-base font-normal text-muted-foreground">
                  {o.track_temp_c_min != null ? "track" : "track max"} ·{" "}
                  {o.rain_share > 0
                    ? `${pct(o.rain_share, 0)} wet laps`
                    : "dry"}
                </span>
              </>
            )}
            {!o && f && (
              <span className="ml-2 text-base font-normal text-muted-foreground">
                {pct(f.p_rain, 0)} rain
              </span>
            )}
          </p>
        </div>
      )}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block h-auto w-full"
        role="img"
        aria-label="Hourly weather"
      >
        {ticks.map((v) => (
          <g key={v}>
            <line
              x1={PL}
              x2={W - PR}
              y1={gyT(v)}
              y2={gyT(v)}
              stroke="var(--border)"
            />
            <text
              x={PL - 6}
              y={gyT(v)}
              dy="0.35em"
              textAnchor="end"
              fontSize={10}
              fill="var(--muted-foreground)"
            >
              {v}°
            </text>
          </g>
        ))}
        {[0, 25, 50, 75, 100].map((p) => (
          <text
            key={p}
            x={W - PR + 6}
            y={gyR(p)}
            dy="0.35em"
            fontSize={10}
            fill="var(--tyre-wet)"
          >
            {p}%
          </text>
        ))}
        {sess.map(({ s, t }) => {
          const isRace = s.session_id === "R";
          const w = Math.max(3, gx(t + hoursOf(s.session_id) * 36e5) - gx(t));
          return (
            <g key={s.session_id}>
              <rect
                x={gx(t)}
                y={PT}
                width={w}
                height={H - PT - PB}
                fill="var(--foreground)"
                opacity={isRace ? 0.16 : 0.06}
              />
              <text
                x={gx(t)}
                y={PT - 8}
                fontSize={10}
                fill="var(--muted-foreground)"
              >
                {s.session_id}
              </text>
            </g>
          );
        })}
        {hr.map((h) => (
          <rect
            key={h.t}
            x={gx(h.t) - bw / 2}
            y={gyR(h.r)}
            width={bw}
            height={gyR(0) - gyR(h.r)}
            fill="var(--tyre-wet)"
            opacity={0.4}
            onPointerEnter={tip.show(
              <>
                {new Date(h.t).toUTCString().slice(0, 22)} UTC
                <br />
                {h.a.toFixed(1)}°C · {h.r.toFixed(0)}% rain
              </>,
            )}
            onPointerLeave={tip.hide}
          />
        ))}
        <path
          d={hr
            .map(
              (h, i) =>
                `${i ? "L" : "M"}${gx(h.t).toFixed(1)},${gyT(h.a).toFixed(1)}`,
            )
            .join("")}
          fill="none"
          stroke="var(--foreground)"
          strokeWidth={1.6}
        />
        {sess.map(({ s, t, track }) => {
          if (!track) return null;
          const cx = gx(t + hoursOf(s.session_id) * 18e5);
          return (
            <g
              key={s.session_id}
              onPointerEnter={tip.show(
                `${s.session_id} track temperature: ${trackText(track)}`,
              )}
              onPointerLeave={tip.hide}
            >
              {track.min != null ? (
                <line
                  x1={cx}
                  x2={cx}
                  y1={gyT(track.max)}
                  y2={gyT(track.min)}
                  stroke="var(--warning)"
                  strokeWidth={3}
                  strokeLinecap="round"
                />
              ) : (
                <circle
                  cx={cx}
                  cy={gyT(track.max)}
                  r={3.5}
                  fill="var(--warning)"
                />
              )}
              <text
                x={cx + 6}
                y={gyT(track.max)}
                dy="0.35em"
                fontSize={10}
                fill="var(--warning)"
              >
                {track.max.toFixed(0)}°
              </text>
              {track.min != null && (
                <text
                  x={cx + 6}
                  y={gyT(track.min)}
                  dy="0.35em"
                  fontSize={10}
                  fill="var(--warning)"
                >
                  {track.min.toFixed(0)}°
                </text>
              )}
            </g>
          );
        })}
        {hr
          .filter((h) => new Date(h.t).getUTCHours() === 12)
          .map((h) => (
            <text
              key={h.t}
              x={gx(h.t)}
              y={H - 8}
              textAnchor="middle"
              fontSize={10}
              fill="var(--muted-foreground)"
            >
              {new Date(h.t).toLocaleDateString("en-GB", {
                weekday: "short",
                timeZone: "UTC",
              })}
            </text>
          ))}
      </svg>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse text-sm tnum">
          <thead>
            <tr className="label-caps text-left">
              {[
                "Session",
                "Air avg",
                "Track min–max",
                "Humidity avg",
                "Wind avg",
                "Wet laps",
              ].map((c) => (
                <th
                  key={c}
                  className="whitespace-nowrap border-b border-border px-2 py-1.5 font-semibold"
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sess.map(({ s, track }) => {
              const ob = s.observed;
              const fc = s.forecast;
              return (
                <tr
                  key={s.session_id}
                  className="[&>td]:border-b [&>td]:border-border [&>td]:px-2 [&>td]:py-1.5 [&>td]:whitespace-nowrap"
                >
                  <td className="font-display font-bold">
                    {s.session_id}{" "}
                    <span className="font-sans text-[11px] font-normal text-muted-foreground">
                      {NAME[s.session_id]}
                    </span>
                  </td>
                  <td>
                    {ob
                      ? `${ob.air_temp_c_mean.toFixed(1)}°C`
                      : fc
                        ? `${fc.air_temp_c.toFixed(0)}°C fcst`
                        : "—"}
                  </td>
                  <td className="text-warning">{trackText(track)}</td>
                  <td>{ob ? pct(ob.humidity_mean, 0) : "—"}</td>
                  <td>
                    {ob
                      ? `${ob.wind_speed_ms_mean.toFixed(1)} m/s`
                      : fc
                        ? `${fc.wind_speed_ms.toFixed(1)} m/s`
                        : "—"}
                  </td>
                  <td className="text-muted-foreground">
                    {ob
                      ? pct(ob.rain_share, 0)
                      : fc
                        ? `${pct(fc.p_rain, 0)} chance`
                        : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {cl && cl.seasons.length > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          Wet in {pct(cl.wet_race_share, 0)} of races here since{" "}
          {Math.min(...cl.seasons)}.
        </p>
      )}
    </div>
  );
}
