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
    <div className="grid gap-6 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)]">
      <svg
        viewBox={`-20 -20 ${S + 40} ${S + 40}`}
        className="w-full max-w-sm"
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
                r={on ? 11 : 7}
                fill={on ? "var(--primary)" : "var(--card)"}
                stroke="var(--muted-foreground)"
                strokeWidth={1}
              />
              <text
                x={k.x * S}
                y={k.y * S}
                dy="0.35em"
                textAnchor="middle"
                fontSize={on ? 10 : 7}
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
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <Stat
            label="Length"
            value={c.length_km != null ? `${c.length_km.toFixed(3)}` : "—"}
            unit="km"
          />
          <Stat
            label="Laps"
            value={c.race_laps != null ? String(c.race_laps) : "—"}
          />
        </div>
        <p className="text-xs text-muted-foreground tnum">
          {c.locality} · {c.lat.toFixed(4)}°, {c.lon.toFixed(4)}°
        </p>
        {hover != null && <p className="font-display text-sm">Turn {hover}</p>}
        {winners.length > 0 && (
          <div>
            <p className="label-caps mb-2">Past winners</p>
            <ul className="space-y-1.5 text-sm">
              {winners.map((w) => (
                <li key={w.season} className="flex gap-3">
                  <span className="w-10 text-muted-foreground tnum">
                    {w.season}
                  </span>
                  <span className="truncate">{w.driver_name}</span>
                  <span className="ml-auto truncate text-xs text-muted-foreground">
                    {w.team_name}
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

export function Stat({
  label,
  value,
  unit,
  accent,
}: {
  label: string;
  value: string;
  unit?: string;
  accent?: boolean;
}) {
  return (
    <div>
      <p className="label-caps mb-1">{label}</p>
      <p
        className={`font-display text-3xl font-semibold leading-none tnum ${accent ? "text-primary" : ""}`}
      >
        {value}
        {unit && (
          <span className="ml-1 text-sm font-normal text-muted-foreground">
            {unit}
          </span>
        )}
      </p>
    </div>
  );
}
