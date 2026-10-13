import { useState } from "react";
import type { FinishingOrderDoc, RaceRow } from "@/data/types";
import { cn } from "@/lib/utils";
import { BumpChart, type BumpColumn } from "./Bump";
import { actualOrder, predictedOrder, scorecard } from "./compare";
import { Heatmap } from "./Heatmap";
import { pct, probNoun, useRace } from "./context";

type Mode = "heat" | "trend" | "result";
const MODE_LABEL: Record<Mode, string> = {
  heat: "Positions",
  trend: "Trend",
  result: "vs Result",
};

function sortKey(e: number | null) {
  return e ?? Number.POSITIVE_INFINITY;
}

export function FinishingOrderView({
  doc,
  stageLabel,
  trend,
  result,
}: {
  doc: FinishingOrderDoc;
  /** The stage this prediction was made at. */
  stageLabel: string;
  /** Every snapshot up to this one, in weekend order. */
  trend: { label: string; doc: FinishingOrderDoc }[];
  /** The race classification, once the race has run. */
  result?: RaceRow[] | undefined;
}) {
  const modes: Mode[] = result
    ? ["result", "heat", "trend"]
    : ["heat", "trend"];
  const [mode, setMode] = useState<Mode>(modes[0]!);
  const { drivers } = useRace();
  const noun = probNoun(doc.model.calibrated);
  const rows = [...doc.drivers].sort(
    (a, b) =>
      sortKey(a.expected_position_if_classified) -
      sortKey(b.expected_position_if_classified),
  );
  const favourite = [...doc.drivers].sort((a, b) => b.p_win - a.p_win)[0];
  const hasGrid = rows.some((r) => r.grid_position != null);
  const code = (id: string | undefined) =>
    id ? (drivers.get(id)?.code ?? id) : "—";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        {favourite && (
          <div>
            <p className="label-caps mb-1">Win {noun} · favourite</p>
            <p className="font-display text-4xl font-semibold leading-none tnum">
              {code(favourite.driver_id)}{" "}
              <span className="text-primary">{pct(favourite.p_win)}</span>
            </p>
          </div>
        )}
        <div
          className="inline-flex rounded-sm border border-border p-0.5 text-xs"
          role="group"
          aria-label="View"
        >
          {modes.map((m) => (
            <button
              key={m}
              type="button"
              disabled={m === "trend" && trend.length < 2}
              onClick={() => setMode(m)}
              className={cn(
                "rounded-[3px] px-3 py-1 font-display font-semibold uppercase tracking-wider transition-colors disabled:opacity-30",
                mode === m
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
      </div>

      {mode === "result" && result ? (
        <div key="result" className="stage-fade">
          <VsResult
            doc={doc}
            result={result}
            stageLabel={stageLabel}
            code={code}
          />
        </div>
      ) : mode === "trend" && trend.length >= 2 ? (
        <div key="trend" className="stage-fade">
          <BumpChart
            columns={trend.map((t) => ({
              label: t.label,
              order: predictedOrder(t.doc),
            }))}
          />
          <p className="mt-3 text-[11px] text-muted-foreground">
            Predicted finishing rank after each session. The biggest movers
            between the first and last snapshot are drawn bold.
          </p>
        </div>
      ) : (
        <div key="heat" className="stage-fade">
          <Heatmap
            noun={noun}
            verb="finishes"
            rows={rows.map((r) => ({
              driver_id: r.driver_id,
              probs: r.position_probs,
              bars: [
                { label: "Win", value: r.p_win },
                { label: "Podium", value: r.p_podium },
                { label: "Points", value: r.p_points },
                { label: "DNF", value: r.p_dnf },
              ],
              extra: hasGrid ? (
                <GridDelta
                  grid={r.grid_position ?? null}
                  exp={r.expected_position_if_classified}
                />
              ) : undefined,
            }))}
            extraHeader={hasGrid ? "Grid→" : undefined}
          />
          <p className="mt-3 text-[11px] text-muted-foreground">
            Prediction made after {stageLabel}. Rows sorted by expected
            finishing position if classified. Click a driver to highlight them
            across the page.
          </p>
        </div>
      )}
    </div>
  );
}

function VsResult({
  doc,
  result,
  stageLabel,
  code,
}: {
  doc: FinishingOrderDoc;
  result: RaceRow[];
  stageLabel: string;
  code: (id: string | undefined) => string;
}) {
  const card = scorecard(doc, result);
  const actual = actualOrder(result);
  const status = new Map(result.map((r) => [r.driver_id, r.classified_as]));
  const columns: BumpColumn[] = [
    { label: `Predicted (${stageLabel})`, order: predictedOrder(doc) },
    {
      label: "Result",
      order: actual.order,
      out: actual.out,
      outLabel: (id) =>
        status.get(id) === "R" ? "DNF" : (status.get(id) ?? "out"),
    },
  ];
  const n = Math.min(10, result.length);
  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat
          label="Winner"
          value={`${code(card.winner)}`}
          note={
            card.favourite === card.winner
              ? "favourite won"
              : `favourite ${code(card.favourite)}`
          }
          hit={card.favourite === card.winner}
        />
        <Stat
          label="Podium"
          value={`${card.podiumHits}/3`}
          note="drivers in the predicted top 3"
        />
        <Stat
          label={`Top ${n}`}
          value={`${card.top10Hits}/${n}`}
          note={`drivers in the predicted top ${n}`}
        />
        <Stat
          label="Rank error"
          value={card.meanError == null ? "—" : card.meanError.toFixed(1)}
          note="mean places off, finishers"
        />
      </dl>
      <BumpChart columns={columns} />
      <p className="text-[11px] text-muted-foreground">
        Last prediction before the race (after {stageLabel}) against the
        classification. Dashed lines end in a retirement.
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  note,
  hit,
}: {
  label: string;
  value: string;
  note: string;
  hit?: boolean;
}) {
  return (
    <div>
      <dt className="label-caps mb-1">{label}</dt>
      <dd className="font-display text-2xl font-semibold leading-none tnum">
        {value}
        {hit != null && (
          <span
            className={cn(
              "ml-2 text-sm",
              hit ? "text-foreground" : "text-primary",
            )}
          >
            {hit ? "✓" : "✗"}
          </span>
        )}
      </dd>
      <dd className="mt-1 text-[11px] text-muted-foreground">{note}</dd>
    </div>
  );
}

function GridDelta({ grid, exp }: { grid: number | null; exp: number | null }) {
  if (grid == null || exp == null)
    return (
      <span className="ml-2 w-12 text-[11px] text-muted-foreground">—</span>
    );
  const d = grid - exp;
  return (
    <span className="ml-2 w-12 text-[11px] tnum">
      P{grid}{" "}
      <span
        className={
          d > 0.5
            ? "text-foreground"
            : d < -0.5
              ? "text-primary"
              : "text-muted-foreground"
        }
      >
        {d > 0 ? "▲" : d < 0 ? "▼" : ""}
        {Math.abs(d).toFixed(1)}
      </span>
    </span>
  );
}
