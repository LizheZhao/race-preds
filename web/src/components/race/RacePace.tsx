import { useState } from "react";
import type { ResultsDoc } from "@/data/types";
import { cn } from "@/lib/utils";
import { classOrder } from "./compare";
import { TYRE, INITIAL } from "./Strategy";
import { Seg } from "./Seg";
import { useRace } from "./context";
import { useTip } from "./Tip";

type Tab = "stints";
const TABS: { key: Tab; label: string }[] = [
  { key: "stints", label: "Tyre stints" },
];

/** Race tyre stints for every driver in finishing order. */
export function RacePaceView({ doc }: { doc: ResultsDoc }) {
  const [tab, setTab] = useState<Tab>("stints");
  return (
    <div>
      {TABS.length > 1 && (
        <div className="mb-3">
          <Seg label="View" options={TABS} value={tab} onChange={setTab} />
        </div>
      )}
      {tab === "stints" && <Stints doc={doc} />}
    </div>
  );
}

function Stints({ doc }: { doc: ResultsDoc }) {
  const { event, drivers, colorOf, highlight, toggleHighlight } = useRace();
  const tip = useTip();
  const strategies = new Map(
    (doc.race_strategies ?? []).map((s) => [s.driver_id, s.stints]),
  );
  const { order, out } = classOrder(doc.race ?? []);
  const ids = order.length ? order : [...strategies.keys()];
  const L =
    event?.circuit.race_laps ??
    Math.max(
      1,
      ...[...strategies.values()].flatMap((s) => s.map((x) => x.end_lap)),
    );
  const x = (lap: number) => ((lap - 1) / L) * 100;
  const cols = "grid-cols-[44px_70px_minmax(0,1fr)_120px]";

  return (
    <div className="overflow-x-auto">
      {tip.node}
      <div className="min-w-[560px]">
        {ids.map((id, i) => {
          const stints = strategies.get(id) ?? [];
          const code = drivers.get(id)?.code ?? id;
          const on = highlight === id;
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
                "grid h-[22px] cursor-pointer items-center transition-opacity duration-150",
                cols,
                highlight != null && !on && "opacity-30",
                on && "bg-foreground/5",
              )}
            >
              <span className="text-[11px] text-muted-foreground tnum">
                {out.has(id) ? "DNF" : `P${i + 1}`}
              </span>
              <span className="flex items-center">
                <span
                  className="mr-1.5 h-3.5 w-[3px] rounded-sm"
                  style={{ background: colorOf(id) }}
                />
                <span className="font-display text-[13px] font-semibold">
                  {code}
                </span>
              </span>
              <div className="relative h-3">
                {stints.map((s, k) => (
                  <span
                    key={k}
                    className="absolute inset-y-0 rounded-[2px]"
                    style={{
                      left: `${x(s.start_lap)}%`,
                      width: `${x(s.end_lap + 1) - x(s.start_lap)}%`,
                      background: TYRE[s.compound],
                    }}
                    onPointerEnter={tip.show(
                      <>
                        {code} {s.compound} · laps {s.start_lap}–{s.end_lap}
                      </>,
                    )}
                    onPointerLeave={tip.hide}
                  />
                ))}
                {stints.slice(1).map((s) => (
                  <span
                    key={s.start_lap}
                    className="pointer-events-none absolute top-[13px] -translate-x-1/2 text-[9px] leading-none text-muted-foreground tnum"
                    style={{ left: `${x(s.start_lap)}%` }}
                  >
                    {s.start_lap}
                  </span>
                ))}
              </div>
              <span className="text-right text-[11px] text-muted-foreground">
                {stints.length
                  ? `${stints.length - 1}-stop ${stints.map((s) => INITIAL[s.compound]).join("–")}`
                  : "—"}
              </span>
            </div>
          );
        })}
        <div className="ml-[114px] mr-[120px] mt-1.5 flex justify-between text-[11px] text-muted-foreground tnum">
          <span>Lap 1</span>
          <span>Numbers under a bar = pit lap</span>
          <span>Lap {L}</span>
        </div>
      </div>
    </div>
  );
}
