import { useState } from "react";
import type { FinishingOrderDoc, ResultsDoc } from "@/data/types";
import { BumpChart, type BumpColumn } from "./Bump";
import { predictedOrder, scorecard, sessionColumns } from "./compare";
import { DriverCard } from "./DriverCard";
import { Heatmap } from "./Heatmap";
import { Seg } from "./Seg";
import { Stat } from "./Stat";
import { pct, probNoun, useRace } from "./context";

type Mode = "heat" | "trend" | "sessions";

export function FinishingOrderView({
  doc,
  stageLabel,
  trend,
  results,
  scored,
}: {
  doc: FinishingOrderDoc;
  /** The stage this prediction was made at. */
  stageLabel: string;
  /** Predicted order per session being predicted, first to last. */
  trend: BumpColumn[];
  results?: ResultsDoc | undefined;
  /** Compare this prediction with the race result (false when viewing an earlier snapshot). */
  scored: boolean;
}) {
  const [mode, setMode] = useState<Mode>("heat");
  const { drivers } = useRace();
  const noun = probNoun(doc.model.calibrated);
  const code = (id: string | undefined) =>
    id ? (drivers.get(id)?.code ?? id) : "—";
  const race = scored ? (results?.race ?? undefined) : undefined;
  const sessions = results ? sessionColumns(results) : [];
  const favourite = [...doc.drivers].sort((a, b) => b.p_win - a.p_win)[0];
  const card = race ? scorecard(doc, race) : undefined;
  const n = Math.min(10, race?.length ?? 10);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-8 gap-y-3">
        <p className="text-sm text-muted-foreground">
          {mode === "heat"
            ? `Position ${noun}s for every driver, after ${stageLabel}.`
            : mode === "trend"
              ? "How the predicted race order moved through the weekend."
              : "Where each driver finished in every session so far."}
        </p>
        <Seg
          label="View"
          value={mode}
          onChange={setMode}
          options={[
            { key: "heat", label: "Positions" },
            {
              key: "trend",
              label: "Prediction trend",
              short: "Trend",
              disabled: trend.length < 2,
            },
            {
              key: "sessions",
              label: "Session results",
              short: "Sessions",
              disabled: sessions.length < 2,
            },
          ]}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div key={mode} className="stage-fade min-w-0">
          {mode === "heat" && <Heatmap doc={doc} noun={noun} result={race} />}
          {mode === "trend" && (
            <>
              <BumpChart columns={trend} />
              <p className="mt-2 text-[11px] text-muted-foreground">
                How the predicted race order moved through the weekend.
              </p>
            </>
          )}
          {mode === "sessions" && (
            <>
              <BumpChart columns={sessions} />
              <p className="mt-2 text-[11px] text-muted-foreground">
                Where each driver actually finished in every session. Dashed
                lines end in a retirement.
              </p>
            </>
          )}
        </div>
        <DriverCard doc={doc} results={results} stageLabel={stageLabel} />
      </div>
    </div>
  );
}
