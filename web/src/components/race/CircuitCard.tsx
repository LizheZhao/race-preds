import { useState } from "react";
import type { EventDoc } from "@/data/types";
import { Stat } from "./Stat";

const S = 300;

export function CircuitView({ event }: { event: EventDoc }) {
  const c = event.circuit;
  const [hover, setHover] = useState<number | null>(null);
  const pts = c.outline.map(([x, y]) => `${x * S},${y * S}`).join(" ");
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-3 gap-3">
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
      </div>
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
                stroke="var(--muted-foreground)"
                strokeWidth={1}
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
    </div>
  );
}
