import type { FinishingOrderDoc, RaceRow } from "@/data/types";
import { cn } from "@/lib/utils";
import { gainClass, gainLabel, medianPosition, placesGained } from "./format";
import { pct, useRace } from "./context";
import { useTip } from "./Tip";
import { useWidth } from "./useWidth";

const ROW = 22;
const CELL = 18;
const MIN_CELL = 8;
const GAP = 2;
const BAR_PX = 28;
const STATS_PX = 232 + 52;
const GAIN_TIP =
  "Grid slot minus the most likely finish. ▲2 means the model expects this driver to gain 2 places from where they start. ▼ means expected to lose places.";

/** Drivers × finishing positions. Column count comes from the data, never hardcoded. */
export function Heatmap({
  doc,
  noun,
  result,
}: {
  doc: FinishingOrderDoc;
  noun: string;
  result?: RaceRow[] | undefined;
}) {
  const { drivers, colorOf, highlight, toggleHighlight } = useRace();
  const tip = useTip();
  const [ref, width] = useWidth<HTMLDivElement>();
  const rows = [...doc.drivers].sort(
    (a, b) =>
      (a.expected_position_if_classified ?? Infinity) -
      (b.expected_position_if_classified ?? Infinity),
  );
  const n = Math.max(0, ...rows.map((r) => r.position_probs.length));
  const max = Math.max(1e-4, ...rows.flatMap((r) => r.position_probs));
  const byId = new Map((result ?? []).map((r) => [r.driver_id, r]));
  // Narrow screens drop the stat columns and shrink the cells so every position stays in view.
  const full = 26 + 78 + n * (CELL + GAP) + STATS_PX;
  const compact = width > 0 && width < full;
  const cell = compact
    ? Math.max(MIN_CELL, Math.min(CELL, Math.floor((width - 92) / n) - GAP))
    : CELL;
  const cols = (
    compact
      ? ["22px", "70px", `${n * (cell + GAP)}px`]
      : ["26px", "78px", `${n * (cell + GAP)}px`, "repeat(4, 58px)", "52px"]
  ).join(" ");
  const minWidth = compact ? 92 + n * (cell + GAP) : full;
  const tick = (k: number) =>
    cell >= 14 || k === 0 || (k + 1) % 5 === 0 ? k + 1 : "";
  const head =
    "flex items-end pb-1 font-display text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground";
  const right = "justify-end pr-2";

  return (
    <div ref={ref} className="overflow-x-auto">
      {tip.node}
      <div style={{ minWidth }}>
        <div className="grid h-6" style={{ gridTemplateColumns: cols }}>
          <span />
          <span className={head}>Driver</span>
          <span
            className={cn(head, "tnum")}
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${n}, ${cell}px)`,
              gap: GAP,
            }}
          >
            {Array.from({ length: n }, (_, k) => (
              <span key={k} className="text-center">
                {tick(k)}
              </span>
            ))}
          </span>
          {!compact &&
            ["Win", "Podium", "Points", "DNF"].map((l) => (
              <span key={l} className={cn(head, right)}>
                {l}
              </span>
            ))}
          {!compact && (
            <span className={cn(head, right)}>
              <span
                className="cursor-help border-b border-dotted border-muted-foreground"
                onPointerEnter={tip.show(GAIN_TIP)}
                onPointerLeave={tip.hide}
              >
                Gain
              </span>
            </span>
          )}
        </div>
        {rows.map((r, i) => {
          const id = r.driver_id;
          const d = drivers.get(id);
          const name = d ? `${d.first_name} ${d.last_name}` : id;
          const res = byId.get(id);
          const rp = res?.position ?? null;
          const gain = placesGained(
            r.grid_position ?? null,
            medianPosition(r.position_probs),
          );
          const on = highlight === id;
          const num = "text-xs tnum";
          return (
            <div
              key={id}
              role="button"
              tabIndex={0}
              onClick={() => toggleHighlight(id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggleHighlight(id);
                }
              }}
              className={cn(
                "grid cursor-pointer items-center transition-opacity duration-150",
                highlight != null && !on && "opacity-30",
                on && "bg-foreground/5",
              )}
              style={{ gridTemplateColumns: cols, height: ROW }}
            >
              <span className="text-[11px] text-muted-foreground tnum">
                {i + 1}
              </span>
              <span className="flex items-center">
                <span
                  className="mr-1.5 h-3.5 w-[3px] shrink-0 rounded-sm"
                  style={{ background: colorOf(id) }}
                />
                <span className="font-display text-[13px] font-semibold">
                  {d?.code ?? id}
                </span>
                {!compact && (
                  <span className="ml-1.5 text-[11px] text-muted-foreground tnum">
                    {d?.number}
                  </span>
                )}
                {res && rp == null && (
                  <span className="ml-1.5 text-[11px] font-semibold text-result">
                    {res.classified_as === "R" ? "DNF" : res.classified_as}
                  </span>
                )}
              </span>
              <span
                className="grid"
                style={{
                  gridTemplateColumns: `repeat(${n}, ${cell}px)`,
                  gap: GAP,
                }}
              >
                {Array.from({ length: n }, (_, k) => {
                  const p = r.position_probs[k] ?? 0;
                  const isResult = rp === k + 1;
                  const level = Math.max(
                    4,
                    Math.round(Math.sqrt(p / max) * 100),
                  );
                  return (
                    <span
                      key={k}
                      onPointerEnter={tip.show(
                        <>
                          <b>{name}</b> finishes P{k + 1}: {pct(p)} {noun}
                          {isResult && (
                            <div className="text-result">Actual result</div>
                          )}
                        </>,
                      )}
                      onPointerLeave={tip.hide}
                      className={cn(
                        "block",
                        isResult &&
                          "relative z-10 outline-2 -outline-offset-1 outline-result",
                      )}
                      style={{
                        height: cell >= 14 ? CELL : cell + 6,
                        background: `color-mix(in oklab, var(--primary) ${level}%, transparent)`,
                      }}
                    />
                  );
                })}
              </span>
              {!compact &&
                (
                  [
                    ["Win", r.p_win],
                    ["Podium", r.p_podium],
                    ["Points", r.p_points],
                    ["DNF", r.p_dnf],
                  ] as const
                ).map(([l, v]) => (
                  <span
                    key={l}
                    className="flex items-center justify-end gap-1.5 pr-2"
                    onPointerEnter={tip.show(
                      <>
                        {name} · {l}: {pct(v)} {noun}
                      </>,
                    )}
                    onPointerLeave={tip.hide}
                  >
                    <i
                      className={cn(
                        "block h-1 rounded-sm",
                        l === "DNF" ? "bg-flag-red" : "bg-primary",
                      )}
                      style={{ width: Math.max(2, v * BAR_PX) }}
                    />
                    <span className={num}>{Math.round(v * 100)}</span>
                  </span>
                ))}
              {!compact && (
                <span className={cn(num, "pr-2 text-right", gainClass(gain))}>
                  {gainLabel(gain)}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block size-3"
            style={{
              background:
                "linear-gradient(90deg, color-mix(in oklab, var(--primary) 6%, transparent), var(--primary))",
            }}
          />
          Deeper blue = higher {noun}
        </span>
        {result && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block size-3 outline-2 -outline-offset-2 outline-result" />
            Actual finishing position
          </span>
        )}
      </div>
    </div>
  );
}
