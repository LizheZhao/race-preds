import type {
  EventDoc,
  FinishingOrderDoc,
  QualifyingDoc,
  RaceRow,
  ResultsDoc,
} from "@/data/types";
import type { BumpColumn } from "./Bump";

/** Driver ids in predicted order: expected position if classified, ties by win score. */
export function predictedOrder(doc: FinishingOrderDoc): string[] {
  return [...doc.drivers]
    .sort(
      (a, b) =>
        (a.expected_position_if_classified ?? Infinity) -
          (b.expected_position_if_classified ?? Infinity) || b.p_win - a.p_win,
    )
    .map((d) => d.driver_id);
}

/** Drivers with a value for `key` first, by that value, then the rest in the order the result lists them. */
export function classOrder(
  rows: RaceRow[],
  key: "position" | "grid" = "position",
): { order: string[]; out: Set<string> } {
  const placed = rows
    .filter((r) => r[key] != null)
    .sort((a, b) => a[key]! - b[key]!);
  const rest = rows.filter((r) => r[key] == null);
  return {
    order: [...placed, ...rest].map((r) => r.driver_id),
    out: new Set(rest.map((r) => r.driver_id)),
  };
}

export const actualOrder = (race: RaceRow[]) => classOrder(race);

const OUT_LABEL: Record<string, string> = {
  R: "DNF",
  D: "DSQ",
  E: "EXC",
  W: "WD",
  N: "NC",
};

/** Actual classifications in session order; sessions the weekend did not run are skipped. */
export function sessionColumns(results: ResultsDoc): BumpColumn[] {
  const cols: BumpColumn[] = [];
  const cause = (rows: RaceRow[]) => {
    const m = new Map(rows.map((r) => [r.driver_id, r.classified_as]));
    return (id: string) => OUT_LABEL[m.get(id) ?? ""] ?? m.get(id) ?? "out";
  };
  if (results.sprint) {
    const grid = classOrder(results.sprint, "grid");
    cols.push({
      label: "Sprint Quali",
      order: grid.order,
      out: grid.out,
      outLabel: () => "Pit",
    });
    const sprint = classOrder(results.sprint);
    cols.push({
      label: "Sprint",
      order: sprint.order,
      out: sprint.out,
      outLabel: cause(results.sprint),
    });
  }
  if (results.qualifying)
    cols.push({
      label: "Qualifying",
      order: [...results.qualifying]
        .sort((a, b) => a.position - b.position)
        .map((r) => r.driver_id),
    });
  if (results.race) {
    const race = classOrder(results.race);
    cols.push({
      label: "Race",
      order: race.order,
      out: race.out,
      outLabel: cause(results.race),
      result: true,
    });
  }
  return cols;
}

/** Predicted order of a qualifying document: expected position, best first. */
export const qualifyingOrder = (doc: QualifyingDoc) =>
  [...doc.drivers]
    .sort((a, b) => a.expected_position - b.expected_position)
    .map((d) => d.driver_id);

/**
 * Columns are named for the session being predicted. The first is the championship order,
 * which is all the model has before any competitive session.
 */
export function predictionColumns(
  event: EventDoc | undefined,
  qualifying: QualifyingDoc | undefined,
  race: FinishingOrderDoc,
): BumpColumn[] {
  const cols: BumpColumn[] = [];
  if (event) {
    const champ = [...event.standings.drivers]
      .sort((a, b) => a.position - b.position)
      .map((d) => d.driver_id);
    const rest = event.drivers
      .map((d) => d.id)
      .filter((id) => !champ.includes(id));
    cols.push({
      label: "Pre / Practice",
      order: [...champ, ...rest],
      tip: "Before any competitive session the model has no grid, so it falls back to the championship order.",
    });
  }
  if (qualifying)
    cols.push({ label: "Qualifying", order: qualifyingOrder(qualifying) });
  cols.push({ label: "Race", order: predictedOrder(race) });
  return cols;
}

export interface Scorecard {
  favourite: string | undefined;
  winner: string | undefined;
  podiumHits: number;
  top10Hits: number;
  /** Mean absolute gap between predicted rank and finishing position, classified drivers only. */
  meanError: number | null;
}

export function scorecard(doc: FinishingOrderDoc, race: RaceRow[]): Scorecard {
  const pred = predictedOrder(doc);
  const { order, out } = actualOrder(race);
  const hits = (k: number) =>
    pred
      .slice(0, k)
      .filter((id) => order.slice(0, k).includes(id) && !out.has(id)).length;
  const errors = order
    .filter((id) => !out.has(id) && pred.includes(id))
    .map((id) => Math.abs(pred.indexOf(id) - order.indexOf(id)));
  return {
    favourite: [...doc.drivers].sort((a, b) => b.p_win - a.p_win)[0]?.driver_id,
    winner: out.has(order[0] ?? "") ? undefined : order[0],
    podiumHits: hits(3),
    top10Hits: hits(10),
    meanError: errors.length
      ? errors.reduce((a, b) => a + b, 0) / errors.length
      : null,
  };
}
