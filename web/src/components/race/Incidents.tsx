import type { RaceIncidentsDoc, ResultsDoc } from "@/data/types";
import { pct, probNoun } from "./context";
import { plural } from "./format";
import { Stat } from "./Stat";
import { useTip } from "./Tip";

const TYPES = [
  {
    label: "Safety car",
    p: (d: RaceIncidentsDoc) => d.p_safety_car,
    red: false,
  },
  {
    label: "Virtual safety car",
    p: (d: RaceIncidentsDoc) => d.p_vsc,
    red: false,
  },
  { label: "Red flag", p: (d: RaceIncidentsDoc) => d.p_red_flag, red: true },
];

export function IncidentsView({
  doc,
  actual,
}: {
  doc: RaceIncidentsDoc;
  /** What happened in the race, once it has run. */
  actual?: NonNullable<ResultsDoc["race_incidents"]> | null | undefined;
}) {
  const tip = useTip();
  const noun = probNoun(doc.model.calibrated);
  const maxW = Math.max(0.01, ...doc.by_lap_window.map((w) => w.p_safety_car));
  const hist = [...(doc.circuit_history ?? [])].reverse();
  return (
    <div>
      {tip.node}
      <div className="mb-3 flex flex-wrap gap-x-8 gap-y-3">
        <Stat label="Safety car" value={pct(doc.p_safety_car, 0)} />
        <Stat label="VSC" value={pct(doc.p_vsc, 0)} />
        <Stat label="Red flag" value={pct(doc.p_red_flag, 0)} />
        <Stat
          label={
            <span
              className="cursor-help border-b border-dotted border-muted-foreground"
              onPointerEnter={tip.show(
                "Expected number of safety car periods in this race",
              )}
              onPointerLeave={tip.hide}
            >
              SCs expected
            </span>
          }
          value={doc.expected_safety_cars.toFixed(1)}
          note="safety car periods"
        />
      </div>

      {TYPES.map((t) => (
        <div
          key={t.label}
          className="grid h-[30px] grid-cols-[140px_minmax(0,1fr)_56px] items-center gap-3 text-sm"
        >
          <span>{t.label}</span>
          <span className="relative h-2 rounded-full bg-foreground/10">
            <i
              className={`absolute inset-y-0 left-0 rounded-full ${t.red ? "bg-flag-red" : "bg-flag-yellow"}`}
              style={{ width: `${t.p(doc) * 100}%` }}
            />
          </span>
          <span className="text-right tnum">{pct(t.p(doc), 0)}</span>
        </div>
      ))}
      {actual && (
        <p className="mt-1.5 text-[11px] text-result tnum">
          Race: {plural(actual.safety_cars, "safety car")} · {actual.vscs} VSC ·{" "}
          {plural(actual.red_flags, "red flag")}
        </p>
      )}

      <p className="label-caps mb-2 mt-5">Safety car {noun} by lap window</p>
      <div
        className="grid h-[120px] items-end gap-1.5"
        style={{
          gridTemplateColumns: `repeat(${doc.by_lap_window.length}, minmax(0, 1fr))`,
        }}
      >
        {doc.by_lap_window.map((w) => (
          <div
            key={w.start_lap}
            className="flex h-full flex-col items-center justify-end gap-1"
            onPointerEnter={tip.show(
              <>
                Laps {w.start_lap}–{w.end_lap}: {pct(w.p_safety_car)} {noun}
              </>,
            )}
            onPointerLeave={tip.hide}
          >
            <span className="text-[11px] text-muted-foreground tnum">
              {Math.round(w.p_safety_car * 100)}
            </span>
            <i
              className="block w-full border border-foreground bg-flag-yellow"
              style={{ height: (w.p_safety_car / maxW) * 70 }}
            />
            <span className="text-[11px] text-muted-foreground tnum">
              {w.start_lap}–{w.end_lap}
            </span>
          </div>
        ))}
      </div>

      {hist.length > 0 && (
        <>
          <p className="label-caps mb-2.5 mt-5">Circuit history</p>
          <div
            className="grid items-end gap-1"
            style={{
              gridTemplateColumns: `repeat(${hist.length}, minmax(0, 1fr))`,
            }}
          >
            {hist.map((h, i) => (
              <div
                key={`${h.season}-${i}`}
                className="flex flex-col items-center gap-1"
                onPointerEnter={tip.show(
                  <>
                    {h.season}: {h.safety_cars} SC · {h.vscs} VSC ·{" "}
                    {h.red_flags} red
                  </>,
                )}
                onPointerLeave={tip.hide}
              >
                <div className="flex min-h-11 flex-col-reverse items-center justify-start gap-[3px]">
                  {Array.from({ length: h.safety_cars }, (_, i) => (
                    <span
                      key={`s${i}`}
                      className="size-[9px] rounded-full bg-foreground"
                    />
                  ))}
                  {Array.from({ length: h.vscs }, (_, i) => (
                    <span
                      key={`v${i}`}
                      className="size-[9px] rounded-full border-[1.5px] border-foreground"
                    />
                  ))}
                  {Array.from({ length: h.red_flags }, (_, i) => (
                    <span
                      key={`r${i}`}
                      className="size-[9px] rounded-full bg-flag-red"
                    />
                  ))}
                  {h.safety_cars + h.vscs + h.red_flags === 0 && (
                    <span className="h-px w-2.5 bg-subtle" />
                  )}
                </div>
                <span className="text-[11px] text-muted-foreground tnum">
                  ’{String(h.season).slice(2)}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-2 flex gap-3.5 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-foreground" />
              SC
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full border-[1.5px] border-foreground" />
              VSC
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-flag-red" />
              Red flag
            </span>
          </p>
        </>
      )}
    </div>
  );
}
