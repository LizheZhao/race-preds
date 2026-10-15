import { useState } from "react";
import type { FinishingOrderDoc, RaceRow } from "@/data/types";
import { cn } from "@/lib/utils";
import { BumpChart, type BumpColumn } from "./Bump";
import { actualOrder, predictedOrder } from "./compare";
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
  const hasGrid = rows.some((r) => r.grid_position != null);
  const code = (id: string | undefined) =>
    id ? (drivers.get(id)?.code ?? id) : "—";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          {mode === "result"
            ? `Predicted after ${stageLabel}, against the race classification.`
            : mode === "trend"
              ? "How the predicted order moved through the weekend."
              : `Position ${noun}s for every driver, after ${stageLabel}.`}
        </p>
        <Segmented
          value={mode}
          options={modes.map((m) => ({
            value: m,
            label: MODE_LABEL[m],
            disabled: m === "trend" && trend.length < 2,
          }))}
          onChange={setMode}
        />
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
          <p className="mt-3 text-xs text-muted-foreground">
            Predicted finishing rank after each session. The biggest movers
            between the first and last snapshot are drawn bold.
          </p>
        </div>
      ) : (
        <div key="heat" className="stage-fade">
          <Heatmap
            compact
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
          <p className="mt-3 text-xs text-muted-foreground">
            Rows sorted by expected finishing position if classified. Click a
            driver to highlight them across the page.
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
  const { colorOf, toggleHighlight, highlight } = useRace();
  const pred = predictedOrder(doc);
  const actual = actualOrder(result);
  const status = new Map(result.map((r) => [r.driver_id, r.classified_as]));
  const outLabel = (id: string) =>
    status.get(id) === "R" ? "DNF" : (status.get(id) ?? "out");
  const columns: BumpColumn[] = [
    { label: `Predicted · ${stageLabel}`, order: pred },
    { label: "Result", order: actual.order, out: actual.out, outLabel },
  ];
  // Where the model missed by the most: retirements first, then the largest rank gaps.
  const misses = pred
    .filter((id) => actual.order.includes(id))
    .map((id) => ({
      id,
      from: pred.indexOf(id) + 1,
      to: actual.order.indexOf(id) + 1,
      out: actual.out.has(id),
    }))
    .sort(
      (a, b) =>
        Number(b.out) - Number(a.out) ||
        Math.abs(b.to - b.from) - Math.abs(a.to - a.from),
    )
    .filter((m) => m.out || m.to !== m.from)
    .slice(0, 7);
  return (
    <div className="@container">
      <div className="grid gap-8 @3xl:grid-cols-[auto_minmax(0,1fr)]">
        <div className="min-w-0">
          <BumpChart columns={columns} />
          <p className="mt-2 text-xs text-muted-foreground">
            Dashed lines end in a retirement.
          </p>
        </div>
        <div className="min-w-0">
          <h3 className="label-caps mb-1">Largest misses</h3>
          <table className="w-full text-sm tnum">
            <thead className="sr-only">
              <tr>
                <th>Driver</th>
                <th>Predicted</th>
                <th>Finished</th>
                <th>Gap</th>
              </tr>
            </thead>
            <tbody>
              {misses.map((m) => {
                const gap = m.from - m.to;
                return (
                  <tr
                    key={m.id}
                    onClick={() => toggleHighlight(m.id)}
                    className={cn(
                      "cursor-pointer border-b border-border transition-opacity",
                      highlight != null && highlight !== m.id && "opacity-35",
                    )}
                  >
                    <td className="py-2">
                      <span
                        className="mr-2 inline-block h-3.5 w-1 align-[-2px]"
                        style={{ background: colorOf(m.id) }}
                      />
                      <span className="cond text-base font-extrabold">
                        {code(m.id)}
                      </span>
                    </td>
                    <td className="py-2 text-muted-foreground">P{m.from}</td>
                    <td className="py-2">
                      {m.out ? (
                        <span className="font-semibold text-flag-red">
                          {outLabel(m.id)}
                        </span>
                      ) : (
                        `P${m.to}`
                      )}
                    </td>
                    <td
                      className={cn(
                        "py-2 text-right font-semibold",
                        m.out
                          ? "text-flag-red"
                          : gap > 0
                            ? "text-gain"
                            : "text-flag-red",
                      )}
                    >
                      {m.out ? "out" : `${gap > 0 ? "▲" : "▼"}${Math.abs(gap)}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-3 max-w-[48ch] text-xs text-muted-foreground">
            ▲ finished higher than predicted, ▼ lower. Click a driver to follow
            them across the page.
          </p>
        </div>
      </div>
    </div>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string; disabled?: boolean }[];
  onChange: (v: T) => void;
}) {
  return (
    <div
      className="inline-flex border border-foreground"
      role="group"
      aria-label="View"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={o.disabled}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "cond px-3 py-1.5 text-sm font-bold tracking-[0.06em] uppercase transition-colors disabled:opacity-30",
            value === o.value
              ? "bg-foreground text-background"
              : "hover:bg-foreground/8",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function GridDelta({ grid, exp }: { grid: number | null; exp: number | null }) {
  if (grid == null || exp == null)
    return <span className="ml-2 w-12 text-xs text-muted-foreground">—</span>;
  const d = grid - exp;
  return (
    <span className="ml-2 w-12 text-xs tnum">
      P{grid}{" "}
      <span
        className={
          d > 0.5
            ? "text-gain"
            : d < -0.5
              ? "text-flag-red"
              : "text-muted-foreground"
        }
      >
        {d > 0 ? "▲" : d < 0 ? "▼" : ""}
        {Math.abs(d).toFixed(1)}
      </span>
    </span>
  );
}
