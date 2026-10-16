import { useState } from "react";
import type {
  EventDoc,
  FinishingOrderDoc,
  ResultsDoc,
  Stage,
} from "@/data/types";
import { BumpChart, type BumpColumn } from "./Bump";
import { DriverCard } from "./DriverCard";
import { Heatmap } from "./Heatmap";
import { Seg } from "./Seg";
import { StageStrip } from "./StageStrip";
import type { StageTile } from "./stages";
import { probNoun } from "./context";
import { Verdict } from "./Verdict";

type Mode = "heat" | "trend" | "sessions";

/** A chart needs two columns with data to draw a line. */
const hasLines = (columns: BumpColumn[]) =>
  columns.filter((c) => c.order).length >= 2;

export function FinishingOrderView({
  doc,
  stageLabel,
  trend,
  results,
  tiles,
  selected,
  current,
  sessionResults,
  sessions,
  onSelect,
}: {
  /** The snapshot for the selected stage, undefined while it loads. */
  doc: FinishingOrderDoc | undefined;
  /** The stage this prediction was made at. */
  stageLabel: string;
  /** One column per stage: the predicted race order, then the result. */
  trend: BumpColumn[];
  /** The championship going in, then one column per session: what it classified. */
  sessionResults: BumpColumn[];
  results?: ResultsDoc | undefined;
  tiles: StageTile[];
  selected: Stage;
  current: Stage;
  sessions: EventDoc["sessions"] | undefined;
  onSelect: (stage: Stage) => void;
}) {
  const [mode, setMode] = useState<Mode>("heat");
  const race = results?.race ?? undefined;
  const enabled = {
    heat: true,
    trend: hasLines(trend),
    sessions: hasLines(sessionResults),
  };
  const view = enabled[mode] ? mode : "heat";

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
              value={view}
              onChange={setMode}
              options={[
                { key: "heat", label: "Positions" },
                {
                  key: "trend",
                  label: "Prediction trend",
                  short: "Trend",
                  disabled: !enabled.trend,
                },
                {
                  key: "sessions",
                  label: "Session results",
                  short: "Results",
                  disabled: !enabled.sessions,
                },
              ]}
            />
          </div>
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
            <div key={view} className="stage-fade min-w-0">
              {view === "heat" && (
                <Heatmap
                  doc={doc}
                  noun={probNoun(doc.model.calibrated)}
                  result={race}
                />
              )}
              {view === "trend" && <BumpChart columns={trend} />}
              {view === "sessions" && <BumpChart columns={sessionResults} />}
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
