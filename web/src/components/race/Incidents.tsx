import type { RaceIncidentsDoc } from "@/data/types";
import { pct, probNoun } from "./context";
import { useTip } from "./Tip";

export function IncidentsView({ doc }: { doc: RaceIncidentsDoc }) {
  const tip = useTip();
  const noun = probNoun(doc.model.calibrated);
  const maxW = Math.max(0.01, ...doc.by_lap_window.map((w) => w.p_safety_car));
  const hist = [...(doc.circuit_history ?? [])].sort(
    (a, b) => a.season - b.season,
  );
  return (
    <div className="space-y-6">
      {tip.node}
      <dl className="grid grid-cols-2 gap-x-5 gap-y-5">
        <Flag
          label="Safety car"
          value={pct(doc.p_safety_car, 0)}
          flag="bg-flag-yellow"
        />
        <Flag
          label="Virtual safety car"
          value={pct(doc.p_vsc, 0)}
          flag="bg-[repeating-linear-gradient(180deg,var(--flag-yellow)_0_6px,var(--foreground)_6px_12px)]"
        />
        <Flag
          label="Red flag"
          value={pct(doc.p_red_flag, 0)}
          flag="bg-flag-red"
        />
        <Flag
          label="Safety cars expected"
          value={doc.expected_safety_cars.toFixed(2)}
          flag=""
        />
      </dl>
      <p className="text-xs text-muted-foreground">
        Percentages are {noun}s for at least one deployment.
      </p>
      <div>
        <p className="label-caps mb-2">Safety car {noun} by lap window</p>
        <div className="flex h-28 items-end gap-1.5">
          {doc.by_lap_window.map((w) => (
            <div
              key={w.start_lap}
              className="flex flex-1 flex-col items-center gap-1"
              onPointerEnter={tip.show(
                <>
                  Laps {w.start_lap}–{w.end_lap}: {pct(w.p_safety_car)} {noun}
                </>,
              )}
              onPointerLeave={tip.hide}
            >
              <span className="text-xs font-semibold tnum">
                {(w.p_safety_car * 100).toFixed(0)}
              </span>
              <span
                className="w-full border border-foreground bg-flag-yellow"
                style={{ height: `${(w.p_safety_car / maxW) * 64}px` }}
              />
              <span className="text-xs text-muted-foreground tnum">
                L{w.start_lap}–{w.end_lap}
              </span>
            </div>
          ))}
        </div>
      </div>
      {hist.length > 0 && (
        <div>
          <p className="label-caps mb-2">Circuit history</p>
          <div className="-mx-1 overflow-x-auto px-1">
            <div className="flex min-w-max gap-3">
              {hist.map((h) => (
                <div
                  key={h.season}
                  className="flex flex-col items-center gap-1"
                  onPointerEnter={tip.show(
                    <>
                      {h.season}: {h.safety_cars} SC · {h.vscs} VSC ·{" "}
                      {h.red_flags} red
                    </>,
                  )}
                  onPointerLeave={tip.hide}
                >
                  <div className="flex h-10 flex-col-reverse items-center gap-0.5">
                    {Array.from({ length: h.safety_cars }, (_, i) => (
                      <span
                        key={`s${i}`}
                        className="size-2 rounded-full bg-flag-yellow ring-1 ring-foreground"
                      />
                    ))}
                    {Array.from({ length: h.vscs }, (_, i) => (
                      <span
                        key={`v${i}`}
                        className="size-2 rounded-full border border-foreground"
                      />
                    ))}
                    {Array.from({ length: h.red_flags }, (_, i) => (
                      <span
                        key={`r${i}`}
                        className="size-2 rounded-full bg-flag-red"
                      />
                    ))}
                    {h.safety_cars + h.vscs + h.red_flags === 0 && (
                      <span className="h-px w-2 bg-subtle" />
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground tnum">
                    ’{String(h.season).slice(2)}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <p className="mt-2 flex gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="size-2 rounded-full bg-flag-yellow ring-1 ring-foreground" />
              SC
            </span>
            <span className="flex items-center gap-1">
              <span className="size-2 rounded-full border border-foreground" />
              VSC
            </span>
            <span className="flex items-center gap-1">
              <span className="size-2 rounded-full bg-flag-red" />
              Red flag
            </span>
          </p>
        </div>
      )}
    </div>
  );
}

function Flag({
  label,
  value,
  flag,
}: {
  label: string;
  value: string;
  flag: string;
}) {
  return (
    <div className="flex items-stretch gap-3">
      <span aria-hidden className={`w-3 shrink-0 ${flag}`} />
      <div>
        <dt className="label-caps">{label}</dt>
        <dd className="xcond mt-1 text-4xl leading-none font-black tnum">
          {value}
        </dd>
      </div>
    </div>
  );
}
