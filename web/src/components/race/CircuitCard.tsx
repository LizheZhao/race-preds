import { useState } from "react";
import type { EventDoc } from "@/data/types";

export function CircuitView({ event }: { event: EventDoc }) {
  const c = event.circuit;
  const [hover, setHover] = useState<number | null>(null);
  const S = 300;
  const pts = c.outline.map(([x, y]) => `${x * S},${y * S}`).join(" ");
  const winners = [...(c.past_winners ?? [])]
    .sort((a, b) => b.season - a.season)
    .slice(0, 5);
  return (
    <div className="grid gap-6 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <svg
        viewBox={`-20 -20 ${S + 40} ${S + 40}`}
        className="w-full max-w-xs"
        role="img"
        aria-label={`${c.name} track map`}
      >
        <polygon
          points={pts}
          fill="none"
          stroke="var(--secondary)"
          strokeWidth={16}
          strokeLinejoin="round"
        />
        <polygon
          points={pts}
          fill="none"
          stroke="var(--foreground)"
          strokeWidth={3.5}
          strokeLinejoin="round"
        />
        {c.outline[0] && (
          <rect
            x={c.outline[0][0] * S - 1.5}
            y={c.outline[0][1] * S - 9}
            width={3}
            height={18}
            fill="var(--flag-red)"
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
                r={on ? 11 : 7.5}
                fill={on ? "var(--foreground)" : "var(--background)"}
                stroke="var(--foreground)"
                strokeWidth={1}
              />
              <text
                x={k.x * S}
                y={k.y * S}
                dy="0.35em"
                textAnchor="middle"
                fontSize={on ? 11 : 8}
                fontWeight={700}
                fill={on ? "var(--background)" : "var(--foreground)"}
                className="tnum"
              >
                {k.number}
                {k.letter}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="space-y-5">
        <dl className="grid grid-cols-3 border-t border-border text-sm tnum">
          <div className="py-2">
            <dt className="text-muted-foreground">Length</dt>
            <dd className="font-bold">
              {c.length_km != null ? `${c.length_km.toFixed(3)} km` : "—"}
            </dd>
          </div>
          <div className="py-2">
            <dt className="text-muted-foreground">Laps</dt>
            <dd className="font-bold">{c.race_laps ?? "—"}</dd>
          </div>
          <div className="py-2">
            <dt className="text-muted-foreground">Corners</dt>
            <dd className="font-bold">{c.corners.length}</dd>
          </div>
        </dl>
        <p className="text-xs text-muted-foreground tnum">
          {c.locality} · {c.lat.toFixed(4)}°, {c.lon.toFixed(4)}°
        </p>
        {hover != null && (
          <p className="cond text-sm font-extrabold uppercase">Turn {hover}</p>
        )}
        {winners.length > 0 && (
          <div>
            <h3 className="label-caps mb-2">Past winners</h3>
            <ul className="text-sm">
              {winners.map((w) => (
                <li
                  key={w.season}
                  className="grid grid-cols-[3rem_1fr] gap-x-2 border-t border-border py-1.5"
                >
                  <span className="text-muted-foreground tnum">{w.season}</span>
                  <span>
                    <span className="font-semibold">{w.driver_name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {w.team_name}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
