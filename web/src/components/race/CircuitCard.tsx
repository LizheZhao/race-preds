import { useState } from "react";
import type { EventDoc } from "@/data/types";
import { cn } from "@/lib/utils";
import { Stat } from "./Stat";

const S = 300;

type Mark = NonNullable<
  NonNullable<EventDoc["circuit"]["speed_trap"]>["weekend"]
>;
const markText = (m: Mark) =>
  `${m.driver_code} · ${m.session_id === "R" ? "race" : m.session_id} ${m.season}`;

export function CircuitView({ event }: { event: EventDoc }) {
  const c = event.circuit;
  const [hover, setHover] = useState<number | null>(null);
  const pts = c.outline.map(([x, y]) => `${x * S},${y * S}`).join(" ");
  const named = c.corners.filter((k) => k.name);
  const trap = c.speed_trap;
  const top = trap?.weekend ?? null;
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          className="text-[26px]"
          label="Length"
          value={
            c.length_km != null ? (
              <>
                {c.length_km.toFixed(3)}
                <span className="ml-1 text-[13px] font-normal text-muted-foreground">
                  km
                </span>
              </>
            ) : (
              "—"
            )
          }
        />
        <Stat
          className="text-[26px]"
          label="Laps"
          value={c.race_laps != null ? String(c.race_laps) : "—"}
        />
        <Stat
          className="text-[26px]"
          label="Corners"
          value={String(c.corners.length)}
        />
        <Stat
          className="text-[26px]"
          label="Top speed"
          value={
            top ? (
              <>
                {top.speed_kph.toFixed(0)}
                <span className="ml-1 text-[13px] font-normal text-muted-foreground">
                  km/h
                </span>
              </>
            ) : (
              "—"
            )
          }
          note={top ? markText(top) : "speed trap, this weekend"}
        />
      </div>
      {trap?.record && (
        <p className="-mt-1 text-xs text-muted-foreground tnum">
          Speed-trap record here
          {trap.record_since != null && ` since ${trap.record_since}`}:{" "}
          <span className="text-foreground">
            {trap.record.speed_kph.toFixed(1)} km/h
          </span>{" "}
          · {markText(trap.record)}
        </p>
      )}
      <svg
        viewBox={`-20 -20 ${S + 40} ${S + 40}`}
        className="mx-auto block w-full max-w-[360px]"
        role="img"
        aria-label={`${c.name} track map`}
      >
        <polygon
          points={pts}
          fill="none"
          stroke="var(--border)"
          strokeWidth={14}
          strokeLinejoin="round"
        />
        <polygon
          points={pts}
          fill="none"
          stroke="var(--foreground)"
          strokeWidth={3}
          strokeLinejoin="round"
        />
        {c.outline[0] && (
          <rect
            x={c.outline[0][0] * S - 1.5}
            y={c.outline[0][1] * S - 9}
            width={3}
            height={18}
            fill="var(--primary)"
          />
        )}
        {c.corners.map((k) => {
          const on = hover === k.number;
          return (
            <g
              key={`${k.number}${k.letter ?? ""}`}
              onPointerEnter={() => setHover(k.number)}
              onPointerLeave={() => setHover(null)}
              className="cursor-default"
            >
              <circle
                cx={k.x * S}
                cy={k.y * S}
                r={on ? 11 : 8}
                fill={on ? "var(--primary)" : "var(--card)"}
                stroke={k.name ? "var(--result)" : "var(--muted-foreground)"}
                strokeWidth={k.name ? 1.5 : 1}
              />
              <text
                x={k.x * S}
                y={k.y * S}
                dy="0.35em"
                textAnchor="middle"
                fontSize={on ? 10 : 8}
                fill="var(--foreground)"
                className="font-display font-semibold tnum"
              >
                {k.number}
                {k.letter}
              </text>
            </g>
          );
        })}
      </svg>
      {named.length > 0 && (
        <ul className="grid gap-1.5 text-xs">
          {named.map((k) => (
            <li
              key={k.number}
              onPointerEnter={() => setHover(k.number)}
              onPointerLeave={() => setHover(null)}
              className={cn(
                "grid grid-cols-[34px_minmax(0,1fr)] gap-2 rounded-sm px-1 py-0.5",
                hover === k.number && "bg-foreground/5",
              )}
            >
              <span className="font-display font-semibold text-result tnum">
                T{k.number}
              </span>
              <span>
                <b className="font-semibold">{k.name}</b>
                {k.name_origin && (
                  <span className="text-muted-foreground">
                    {" "}
                    · {k.name_origin}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
