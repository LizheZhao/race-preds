import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { pct, useRace } from "./context";
import { useTip } from "./Tip";

export interface HeatRow {
  driver_id: string;
  probs: number[];
  bars: { label: string; value: number }[];
  extra?: ReactNode;
}

/** Drivers × positions heatmap. Column count is taken from the data, never hardcoded. */
export function Heatmap({
  rows,
  noun,
  posPrefix = "P",
  verb,
  compact,
  extraHeader,
}: {
  rows: HeatRow[];
  noun: string;
  posPrefix?: string;
  verb: string;
  compact?: boolean;
  extraHeader?: ReactNode;
}) {
  const { drivers, colorOf, highlight, toggleHighlight } = useRace();
  const tip = useTip();
  const n = Math.max(0, ...rows.map((r) => r.probs.length));
  const max = Math.max(0.0001, ...rows.flatMap((r) => r.probs));
  const cell = compact ? 16 : 22;
  const barLabels = rows[0]?.bars.map((b) => b.label) ?? [];

  return (
    <div className="-mx-1 overflow-x-auto px-1">
      {tip.node}
      <div
        style={{
          minWidth:
            92 +
            n * (cell + 2) +
            barLabels.length * 76 +
            (extraHeader ? 56 : 0),
        }}
      >
        <div className="mb-1 flex items-end text-[10px] text-muted-foreground">
          <div className="w-[88px] shrink-0" />
          <div
            className="grid shrink-0 gap-[2px]"
            style={{ gridTemplateColumns: `repeat(${n}, ${cell}px)` }}
          >
            {Array.from({ length: n }, (_, k) => (
              <span key={k} className="text-center tnum">
                {k === 0 || (k + 1) % (compact ? 5 : 1) === 0 || !compact
                  ? k + 1
                  : ""}
              </span>
            ))}
          </div>
          <div className="ml-4 flex gap-3">
            {barLabels.map((l) => (
              <span
                key={l}
                className="w-16 font-display uppercase tracking-wider"
              >
                {l}
              </span>
            ))}
          </div>
          {extraHeader && (
            <div className="ml-2 w-12 font-display uppercase tracking-wider">
              {extraHeader}
            </div>
          )}
        </div>
        <ul className="space-y-[2px]">
          {rows.map((r) => {
            const d = drivers.get(r.driver_id);
            const name = d ? `${d.first_name} ${d.last_name}` : r.driver_id;
            const dim = highlight != null && highlight !== r.driver_id;
            return (
              <li key={r.driver_id}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleHighlight(r.driver_id)}
                  onKeyDown={(e) =>
                    (e.key === "Enter" || e.key === " ") &&
                    toggleHighlight(r.driver_id)
                  }
                  className={cn(
                    "flex cursor-pointer items-center rounded-sm transition-opacity duration-200",
                    dim && "opacity-30",
                    highlight === r.driver_id && "bg-foreground/5",
                  )}
                >
                  <div className="flex w-[88px] shrink-0 items-center gap-2">
                    <span
                      className="h-4 w-[3px] rounded-full"
                      style={{ background: colorOf(r.driver_id) }}
                    />
                    <span className="font-display text-sm font-semibold">
                      {d?.code ?? r.driver_id}
                    </span>
                    <span className="text-[10px] text-muted-foreground tnum">
                      {d?.number}
                    </span>
                  </div>
                  <div
                    className="grid shrink-0 gap-[2px]"
                    style={{ gridTemplateColumns: `repeat(${n}, ${cell}px)` }}
                  >
                    {Array.from({ length: n }, (_, k) => {
                      const p = r.probs[k] ?? 0;
                      return (
                        <span
                          key={k}
                          onPointerEnter={tip.show(
                            <>
                              <b>{name}</b> {verb} {posPrefix}
                              {k + 1}: {pct(p)} {noun}
                            </>,
                          )}
                          onPointerLeave={tip.hide}
                          className="block rounded-[2px] bg-foreground/[0.04]"
                          style={{
                            height: cell,
                            boxShadow: `inset 0 0 0 ${cell}px color-mix(in oklab, var(--foreground) ${Math.round((p / max) * 100)}%, transparent)`,
                          }}
                        />
                      );
                    })}
                  </div>
                  <div className="ml-4 flex gap-3">
                    {r.bars.map((b) => (
                      <span
                        key={b.label}
                        className="flex w-16 items-center gap-1.5"
                        onPointerEnter={tip.show(
                          <>
                            {name} · {b.label}: {pct(b.value)} {noun}
                          </>,
                        )}
                        onPointerLeave={tip.hide}
                      >
                        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-foreground/10">
                          <span
                            className="block h-full rounded-full bg-foreground/80"
                            style={{ width: `${b.value * 100}%` }}
                          />
                        </span>
                        <span className="w-7 text-right text-[10px] text-muted-foreground tnum">
                          {(b.value * 100).toFixed(0)}
                        </span>
                      </span>
                    ))}
                  </div>
                  {r.extra}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
