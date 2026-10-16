import type { FinishingOrderDoc, RaceRow } from "@/data/types";
import { cn } from "@/lib/utils";
import { predictedOrder, scorecard } from "./compare";
import { pct, probNoun, useRace } from "./context";
import { STAGE_LABEL } from "./stages";

/** The one question the page answers first: who the model favours, and whether it came true. */
export function Verdict({
  doc,
  stageLabel,
  result,
}: {
  doc: FinishingOrderDoc;
  stageLabel: string;
  result?: RaceRow[] | undefined;
}) {
  const { drivers, teamOf } = useRace();
  const noun = probNoun(doc.model.calibrated);
  const fav = [...doc.drivers].sort((a, b) => b.p_win - a.p_win)[0];
  if (!fav) return null;
  const d = drivers.get(fav.driver_id);
  const team = teamOf(fav.driver_id);
  const name = d ? `${d.first_name} ${d.last_name}` : fav.driver_id;
  const code = (id: string) => drivers.get(id)?.code ?? id;

  const card = result ? scorecard(doc, result) : null;
  const won = card ? card.winner === fav.driver_id : null;
  const top3 = predictedOrder(doc).slice(0, 3);
  const when =
    stageLabel === STAGE_LABEL.pre_weekend
      ? "before the weekend"
      : `after ${stageLabel}`;

  return (
    <section
      aria-label="Verdict"
      className="grid gap-x-10 gap-y-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <span className="xcond text-[clamp(4.5rem,9vw,7rem)] leading-[0.8] font-black">
            {code(fav.driver_id)}
          </span>
          <span className="xcond text-[clamp(2.5rem,5vw,4rem)] leading-none font-black text-primary tnum">
            {pct(fav.p_win)}
          </span>
          {won != null && (
            <span
              className={cn(
                "stamp ml-1 text-2xl md:text-3xl",
                won ? "text-foreground" : "text-flag-red",
              )}
            >
              {won ? "Won" : "Beaten"}
            </span>
          )}
        </div>
        <p className="mt-4 max-w-[60ch] text-base leading-relaxed md:text-lg">
          {card
            ? `${name}${team ? ` (${team.name})` : ""} was the model's favourite race winner ${when}.`
            : `${name}${team ? ` (${team.name})` : ""} leads the predicted order, ahead of ${top3
                .slice(1)
                .map((id) => code(id))
                .join(" and ")}.`}
        </p>
      </div>

      {card ? (
        <dl className="self-end">
          <Line
            label="Podium"
            value={`${card.podiumHits}/3`}
            note="of the predicted top 3 finished there"
          />
          <Line
            label="Top 10"
            value={`${card.top10Hits}/10`}
            note="of the predicted top 10 scored points"
          />
          <Line
            label="Rank error"
            value={card.meanError == null ? "—" : card.meanError.toFixed(1)}
            note="places off on average, finishers only"
          />
        </dl>
      ) : (
        <dl className="self-end">
          <Line
            label="Podium"
            value={top3.map((id) => code(id)).join(" ")}
            note="predicted top three"
          />
          <Line
            label="Win"
            value={pct(fav.p_win)}
            note={`${noun} for ${code(fav.driver_id)}`}
          />
          <Line
            label="DNF"
            value={pct(fav.p_dnf)}
            note={`retirement ${noun} for ${code(fav.driver_id)}`}
          />
        </dl>
      )}
    </section>
  );
}

function Line({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="grid grid-cols-[6.5rem_auto_1fr] items-baseline gap-x-4 border-t border-border py-2.5 last:border-b">
      <dt className="label-caps">{label}</dt>
      <dd className="xcond text-3xl leading-none font-black tnum">{value}</dd>
      <dd className="text-xs text-muted-foreground">{note}</dd>
    </div>
  );
}
