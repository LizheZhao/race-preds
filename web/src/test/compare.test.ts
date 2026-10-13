import { describe, expect, it } from "vitest";

import {
  actualOrder,
  predictedOrder,
  scorecard,
} from "@/components/race/compare";
import type { FinishingOrderDoc, RaceRow } from "@/data/types";

const pred = (rows: [string, number | null, number][]) =>
  ({
    drivers: rows.map(
      ([driver_id, expected_position_if_classified, p_win]) => ({
        driver_id,
        expected_position_if_classified,
        p_win,
      }),
    ),
  }) as unknown as FinishingOrderDoc;

const race = (rows: [string, number | null][]) =>
  rows.map(([driver_id, position]) => ({
    driver_id,
    position,
    classified_as: position == null ? "R" : String(position),
  })) as unknown as RaceRow[];

// predicted A B C D, A favourite; result B A D, C retired
const doc = pred([
  ["a", 1.2, 0.5],
  ["b", 2.4, 0.3],
  ["c", 3.1, 0.1],
  ["d", 4.0, 0.1],
]);
const result = race([
  ["c", null],
  ["a", 2],
  ["b", 1],
  ["d", 3],
]);

describe("prediction against the result", () => {
  it("orders predictions by expected position, unclassifiable last", () => {
    expect(
      predictedOrder(
        pred([
          ["x", null, 0.9],
          ["y", 5, 0],
          ["z", 2, 0],
        ]),
      ),
    ).toEqual(["z", "y", "x"]);
  });

  it("puts non-finishers after the classified drivers", () => {
    const { order, out } = actualOrder(result);
    expect(order).toEqual(["b", "a", "d", "c"]);
    expect([...out]).toEqual(["c"]);
  });

  it("scores winner, podium, top 10 and mean rank error", () => {
    expect(scorecard(doc, result)).toEqual({
      favourite: "a",
      winner: "b",
      podiumHits: 2,
      top10Hits: 3,
      meanError: 1,
    });
  });
});
