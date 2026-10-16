import { useState } from "react";
import type {
  EventDoc,
  FinishingOrderDoc,
  ResultsDoc,
  Stage,
} from "@/data/types";
import { BumpChart, type BumpColumn } from "./Bump";
import { sessionColumns } from "./compare";
import { DriverCard } from "./DriverCard";
import { Heatmap } from "./Heatmap";
import { Seg } from "./Seg";
import { StageStrip } from "./StageStrip";
import type { StageTile } from "./stages";
import { probNoun } from "./context";
import { Verdict } from "./Verdict";

type Mode = "heat" | "trend" | "sessions";

export function FinishingOrderView({
  doc,
  stageLabel,
  trend,
  results,
  tiles,
  selected,
  current,
  sessions,
  onSelect,
}: {
  /** The snapshot for the selected stage, undefined while it loads. */
  doc: FinishingOrderDoc | undefined;
  /** The stage this prediction was made at. */
  stageLabel: string;
  /** Predicted order per session being predicted, first to last. */
  trend: BumpColumn[];
  results?: ResultsDoc | undefined;
  tiles: StageTile[];
  selected: Stage;
  current: Stage;
  sessions: EventDoc["sessions"] | undefined;
  onSelect: (stage: Stage) => void;
}) {
  const [mode, setMode] = useState<Mode>("heat");
  const race = results?.race ?? undefined;
  const sessionCols = results ? sessionColumns(results) : [];

  return (
    <div>
      <StageStrip
        tiles={tiles}
        selected={selected}
        current={current}
        sessions={sessions}
        onSelect={onSelect}
      />
      {doc ? (
        <div key={selected} className="stage-fade">
          <div className="mt-6">
            <Verdict doc={doc} stageLabel={stageLabel} result={race} />
          </div>
          <div className="mt-6 mb-4">
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
                  short: "Results",
                  disabled: sessionCols.length < 2,
                },
              ]}
            />
          </div>
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
            <div key={mode} className="stage-fade min-w-0">
              {mode === "heat" && (
                <Heatmap
                  doc={doc}
                  noun={probNoun(doc.model.calibrated)}
                  result={race}
                />
              )}
              {mode === "trend" && <BumpChart columns={trend} />}
              {mode === "sessions" && <BumpChart columns={sessionCols} />}
            </div>
            <DriverCard doc={doc} results={results} stageLabel={stageLabel} />
          </div>
        </div>
      ) : (
        <p className="mt-6 text-sm text-muted-foreground">Loading snapshot…</p>
      )}
    </div>
  );
}
