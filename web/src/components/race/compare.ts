import type { FinishingOrderDoc, RaceRow } from "@/data/types";

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

/** Classified finishers by position, then the rest in the order the result lists them. */
export function actualOrder(race: RaceRow[]): {
  order: string[];
  out: Set<string>;
} {
  const classified = race
    .filter((r) => r.position != null)
    .sort((a, b) => a.position! - b.position!);
  const rest = race.filter((r) => r.position == null);
  return {
    order: [...classified, ...rest].map((r) => r.driver_id),
    out: new Set(rest.map((r) => r.driver_id)),
  };
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
