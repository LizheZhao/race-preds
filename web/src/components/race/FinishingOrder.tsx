import { useState } from "react";
import type { FinishingOrderDoc } from "@/data/types";
import { cn } from "@/lib/utils";
import { Heatmap } from "./Heatmap";
import { pct, probNoun, useRace } from "./context";
import { useTip } from "./Tip";

function sortKey(e: number | null) {
  return e ?? Number.POSITIVE_INFINITY;
}

export function FinishingOrderView({
  doc,
  prev,
  prevLabel,
  nowLabel,
}: {
  doc: FinishingOrderDoc;
  prev?: FinishingOrderDoc | undefined;
  prevLabel?: string | undefined;
  nowLabel?: string | undefined;
}) {
  const [mode, setMode] = useState<"heat" | "movers">("heat");
  const { drivers } = useRace();
  const noun = probNoun(doc.model.calibrated);
  const rows = [...doc.drivers].sort(
    (a, b) =>
      sortKey(a.expected_position_if_classified) -
      sortKey(b.expected_position_if_classified),
  );
  const leader = rows[0];
  const favourite = [...doc.drivers].sort((a, b) => b.p_win - a.p_win)[0];
  const hasGrid = rows.some((r) => r.grid_position != null);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        {favourite && (
          <div>
            <p className="label-caps mb-1">Win {noun} · favourite</p>
            <p className="font-display text-4xl font-semibold leading-none tnum">
              {drivers.get(favourite.driver_id)?.code ?? favourite.driver_id}{" "}
              <span className="text-primary">{pct(favourite.p_win)}</span>
            </p>
          </div>
        )}
        <div
          className="inline-flex rounded-sm border border-border p-0.5 text-xs"
          role="group"
          aria-label="View"
        >
          {(["heat", "movers"] as const).map((m) => (
            <button
              key={m}
              type="button"
              disabled={m === "movers" && !prev}
              onClick={() => setMode(m)}
              className={cn(
                "rounded-[3px] px-3 py-1 font-display font-semibold uppercase tracking-wider transition-colors disabled:opacity-30",
                mode === m
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {m === "heat" ? "Positions" : "Movers"}
            </button>
          ))}
        </div>
      </div>

      {mode === "heat" || !prev ? (
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
            Rows sorted by expected finishing position if classified
            {leader ? "" : ""}. Click a driver to highlight them across the
            page.
          </p>
        </div>
      ) : (
        <div key="movers" className="stage-fade">
          <Movers
            doc={doc}
            prev={prev}
            prevLabel={prevLabel ?? "Previous"}
            nowLabel={nowLabel ?? "Now"}
          />
        </div>
      )}
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

function Movers({
  doc,
  prev,
  prevLabel,
  nowLabel,
}: {
  doc: FinishingOrderDoc;
  prev: FinishingOrderDoc;
  prevLabel: string;
  nowLabel: string;
}) {
  const { drivers, colorOf, highlight, toggleHighlight } = useRace();
  const tip = useTip();
  const prevMap = new Map(
    prev.drivers.map((d) => [d.driver_id, d.expected_position_if_classified]),
  );
  const items = doc.drivers
    .map((d) => ({
      id: d.driver_id,
      a: prevMap.get(d.driver_id) ?? null,
      b: d.expected_position_if_classified,
    }))
    .filter(
      (x): x is { id: string; a: number; b: number } =>
        x.a != null && x.b != null,
    );
  const n = Math.max(doc.drivers.length, prev.drivers.length);
  const H = 22 * n + 30,
    W = 520,
    L = 90,
    Rr = W - 90;
  const y = (p: number) => 20 + ((p - 1) / Math.max(1, n - 1)) * (H - 40);
  const deltas = items.map((i) => Math.abs(i.a - i.b));
  const big =
    [...deltas].sort((a, b) => b - a)[Math.min(4, deltas.length - 1)] ?? 0;

  return (
    <div className="-mx-1 overflow-x-auto">
      {tip.node}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="min-w-[480px] w-full max-w-3xl"
        style={{ height: "auto" }}
      >
        <text
          x={L}
          y={10}
          textAnchor="middle"
          className="font-display"
          fontSize={10}
          fill="var(--muted-foreground)"
        >
          {prevLabel}
        </text>
        <text
          x={Rr}
          y={10}
          textAnchor="middle"
          className="font-display"
          fontSize={10}
          fill="var(--muted-foreground)"
        >
          {nowLabel}
        </text>
        <line x1={L} x2={L} y1={16} y2={H - 14} stroke="var(--border)" />
        <line x1={Rr} x2={Rr} y1={16} y2={H - 14} stroke="var(--border)" />
        {items.map((i) => {
          const code = drivers.get(i.id)?.code ?? i.id;
          const d = i.a - i.b;
          const strong = Math.abs(d) >= big && Math.abs(d) > 0.3;
          const dim = highlight ? highlight !== i.id : !strong;
          return (
            <g
              key={i.id}
              onClick={() => toggleHighlight(i.id)}
              className="cursor-pointer"
              onPointerEnter={tip.show(
                <>
                  {code}: {i.a.toFixed(1)} → {i.b.toFixed(1)} (
                  {d > 0 ? "+" : ""}
                  {d.toFixed(1)} places)
                </>,
              )}
              onPointerLeave={tip.hide}
              opacity={dim ? 0.25 : 1}
            >
              <line
                x1={L}
                y1={y(i.a)}
                x2={Rr}
                y2={y(i.b)}
                stroke={colorOf(i.id)}
                strokeWidth={strong || highlight === i.id ? 2.5 : 1.25}
              />
              <circle cx={L} cy={y(i.a)} r={3} fill={colorOf(i.id)} />
              <circle cx={Rr} cy={y(i.b)} r={3} fill={colorOf(i.id)} />
              <text
                x={L - 8}
                y={y(i.a)}
                dy="0.35em"
                textAnchor="end"
                fontSize={10}
                fill="var(--foreground)"
                className="font-display tnum"
              >
                {code} {i.a.toFixed(1)}
              </text>
              <text
                x={Rr + 8}
                y={y(i.b)}
                dy="0.35em"
                fontSize={10}
                fill="var(--foreground)"
                className="font-display tnum"
              >
                {i.b.toFixed(1)} {code}
                {strong ? ` ${d > 0 ? "▲" : "▼"}${Math.abs(d).toFixed(1)}` : ""}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
