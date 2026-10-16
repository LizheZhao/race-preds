import { describe, expect, it } from "vitest";

import {
  classOrder,
  predictedOrder,
  scorecard,
  sessionColumns,
  standingsBefore,
  trendColumns,
} from "@/components/race/compare";
import type {
  EventDoc,
  FinishingOrderDoc,
  RaceRow,
  ResultsDoc,
} from "@/data/types";

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
    const { order, out } = classOrder(result);
    expect(order).toEqual(["b", "a", "d", "c"]);
    expect([...out]).toEqual(["c"]);
  });

  it("scores winner, podium, top 10 and mean rank error", () => {
    expect(scorecard(doc, result)).toEqual({
      winner: "b",
      podiumHits: 2,
      top10Hits: 3,
      meanError: 1,
    });
  });
});

const event = (
  after_round: number,
  standings: [string, number][],
  extra: Partial<EventDoc> = {},
) =>
  ({
    format: "sprint_qualifying",
    meta: { round: 17 },
    drivers: ["a", "b", "c"].map((id) => ({ id })),
    sessions: ["FP1", "SQ", "S", "Q", "R"].map((id) => ({ id })),
    standings: {
      after_round,
      drivers: standings.map(([driver_id, points], i) => ({
        driver_id,
        points,
        position: i + 1,
      })),
    },
    ...extra,
  }) as unknown as EventDoc;

const row = (driver_id: string, points: number) => ({ driver_id, points });

describe("standingsBefore", () => {
  it("takes standings that stop at the previous round as published, entrants they miss last", () => {
    const e = event(16, [
      ["b", 50],
      ["gone", 40],
      ["a", 30],
    ]);
    expect(standingsBefore(e, undefined)).toEqual(["b", "a", "c"]);
  });

  it("takes this round's race and sprint points back out and keeps standings order on ties", () => {
    const e = event(17, [
      ["a", 40],
      ["b", 38],
      ["c", 38],
    ]);
    const results = {
      race: [row("a", 18)],
      sprint: [row("a", 7)],
    } as unknown as ResultsDoc;
    expect(standingsBefore(e, results)).toEqual(["b", "c", "a"]);
  });

  it("has no answer when the standings are from another round, or count this one without its results", () => {
    expect(standingsBefore(event(12, [["a", 1]]), undefined)).toBeNull();
    expect(standingsBefore(event(17, [["a", 1]]), undefined)).toBeNull();
    expect(standingsBefore(event(16, []), undefined)).toBeNull();
  });
});

const classified = (rows: [string, number | null][]) =>
  rows.map(([driver_id, position]) => ({
    driver_id,
    position,
    classified_as: position == null ? "R" : String(position),
    points: 0,
  }));

describe("sessionColumns", () => {
  const results = {
    practice: [
      {
        session_id: "FP1",
        rows: [
          { driver_id: "b", position: 1, best_lap_s: 90 },
          { driver_id: "a", position: 2, best_lap_s: 91 },
        ],
      },
    ],
    qualifying: [
      { driver_id: "a", position: 1 },
      { driver_id: "b", position: 2 },
    ],
    race: classified([
      ["b", 1],
      ["a", null],
    ]),
  } as unknown as ResultsDoc;

  it("has a column for the championship and every session of the weekend, in order", () => {
    const cols = sessionColumns(event(16, [["a", 1]]), results, "R");
    expect(cols.map((c) => c.label)).toEqual([
      "Pre-weekend",
      "FP1",
      "Sprint Q",
      "Sprint",
      "Quali",
      "Race",
    ]);
    expect(cols[1]!.order).toEqual(["b", "a"]);
    expect(cols[4]!.order).toEqual(["a", "b"]);
  });

  it("marks a session that ran with no classification as no data", () => {
    const cols = sessionColumns(event(16, [["a", 1]]), results, "R");
    expect(cols[2]!.order).toBeNull();
    expect(cols[3]!.order).toBeNull();
  });

  it("greys the sessions after the viewed stage and highlights the viewed one", () => {
    const cols = sessionColumns(event(16, [["a", 1]]), results, "FP1");
    expect(cols.map((c) => c.future)).toEqual([
      false,
      false,
      true,
      true,
      true,
      true,
    ]);
    expect(cols.map((c) => c.selected)).toEqual([
      false,
      true,
      false,
      false,
      false,
      false,
    ]);
  });

  it("draws the race retirement as out with its cause", () => {
    const race = sessionColumns(event(16, [["a", 1]]), results, "R")[5]!;
    expect(race.order).toEqual(["b", "a"]);
    expect([...race.out!]).toEqual(["a"]);
    expect(race.outLabel!("a")).toBe("DNF");
    expect(race.result).toBe(true);
  });

  it("shows every column as no data without results", () => {
    const cols = sessionColumns(
      event(16, [["a", 1]]),
      undefined,
      "pre_weekend",
    );
    expect(cols.slice(1).every((c) => c.order == null)).toBe(true);
  });
});

describe("trendColumns", () => {
  const snap = (rows: [string, number][]) =>
    pred(rows.map(([id, pos]) => [id, pos, 0.1]));
  const snapshots = {
    pre_weekend: snap([
      ["a", 1],
      ["b", 2],
    ]),
    FP1: snap([
      ["b", 1],
      ["a", 2],
    ]),
    Q: snap([
      ["a", 1],
      ["b", 2],
    ]),
  };
  const results = {
    race: classified([
      ["b", 1],
      ["a", 2],
    ]),
  } as unknown as ResultsDoc;

  it("has a column per stage before the race, then the result", () => {
    const cols = trendColumns(
      "sprint_qualifying",
      snapshots,
      results,
      "R",
      "Q",
    );
    expect(cols.map((c) => c.label)).toEqual([
      "Pre-weekend",
      "FP1",
      "Sprint Q",
      "Sprint",
      "Quali",
      "Result",
    ]);
    expect(cols.map((c) => c.order == null)).toEqual([
      false,
      false,
      true,
      true,
      false,
      false,
    ]);
    expect(cols[5]!.order).toEqual(["b", "a"]);
  });

  it("highlights the snapshot on show, which is Quali while the race is viewed, and greys nothing", () => {
    const cols = trendColumns(
      "sprint_qualifying",
      snapshots,
      results,
      "R",
      "Q",
    );
    expect(cols.filter((c) => c.selected).map((c) => c.label)).toEqual([
      "Quali",
    ]);
    expect(cols.some((c) => c.future)).toBe(false);
  });

  it("greys every column after the viewed stage, the result included", () => {
    const cols = trendColumns(
      "sprint_qualifying",
      snapshots,
      results,
      "FP1",
      "FP1",
    );
    expect(cols.filter((c) => c.future).map((c) => c.label)).toEqual([
      "Sprint Q",
      "Sprint",
      "Quali",
      "Result",
    ]);
  });

  it("leaves the result without data before the race has run", () => {
    const cols = trendColumns(
      "sprint_qualifying",
      snapshots,
      undefined,
      "Q",
      "Q",
    );
    expect(cols[5]!.order).toBeNull();
    expect(cols[5]!.future).toBe(true);
  });
});
