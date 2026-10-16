import type {
  EventDoc,
  FinishingOrderDoc,
  FinishingSnapshots,
  RaceRow,
  ResultsDoc,
  SessionId,
  Stage,
  WeekendFormat,
} from "@/data/types";
import type { BumpColumn } from "./Bump";
import { isAfter, RACE, STAGE_LABEL, STAGE_ORDER } from "./stages";

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

/** Drivers with a finishing position first, best first, then the rest in the order the result lists them. */
export function classOrder(rows: RaceRow[]): {
  order: string[];
  out: Set<string>;
} {
  const placed = rows
    .filter((r) => r.position != null)
    .sort((a, b) => a.position! - b.position!);
  const rest = rows.filter((r) => r.position == null);
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

/** What a session puts into a chart column. */
interface Classified {
  order: string[];
  out?: Set<string>;
  outLabel?: (id: string) => string;
  tip?: string;
}

const byPosition = (
  rows: { driver_id: string; position: number }[],
): Classified => ({
  order: [...rows]
    .sort((a, b) => a.position - b.position)
    .map((r) => r.driver_id),
});

function finishers(rows: RaceRow[]): Classified {
  const { order, out } = classOrder(rows);
  const cause = new Map(rows.map((r) => [r.driver_id, r.classified_as]));
  return {
    order,
    out,
    outLabel: (id) => OUT_LABEL[cause.get(id) ?? ""] ?? cause.get(id) ?? "out",
  };
}

/** A session's classification out of the results document, or null when it has none. */
type Reader = (r: ResultsDoc) => Classified | null;

const reading =
  <T>(
    rows: (r: ResultsDoc) => T[] | null | undefined,
    classify: (rows: T[]) => Classified,
  ): Reader =>
  (r) => {
    const found = rows(r);
    return found?.length ? classify(found) : null;
  };

const practice = (id: "FP1" | "FP2" | "FP3") =>
  reading(
    (r) => r.practice?.find((p) => p.session_id === id)?.rows,
    byPosition,
  );

/** Where each session of a weekend keeps its classification. */
const CLASSIFICATION: Record<SessionId, Reader> = {
  FP1: practice("FP1"),
  FP2: practice("FP2"),
  FP3: practice("FP3"),
  SQ: reading((r) => r.sprint_qualifying, byPosition),
  S: reading((r) => r.sprint, finishers),
  Q: reading((r) => r.qualifying, byPosition),
  R: reading((r) => r.race, finishers),
};

/** The stage order that tells past from future, the stage being viewed, and the stage whose column is highlighted. */
interface View {
  order: Stage[];
  viewed: Stage;
  selected: Stage;
}

function stageColumn(
  stage: Stage,
  content: Classified | null,
  view: View,
  label = stage === "pre_weekend" ? "Pre-weekend" : STAGE_LABEL[stage],
): BumpColumn {
  return {
    ...content,
    label,
    order: content?.order ?? null,
    future: isAfter(view.order, stage, view.viewed),
    selected: stage === view.selected,
    ...(stage === RACE && { result: true }),
  };
}

/**
 * The championship order going into the weekend. Standings that stop at the previous round
 * are used as published; standings that already count this round have its points taken
 * back out. Entrants the standings do not list come last.
 */
export function standingsBefore(
  event: EventDoc,
  results: ResultsDoc | undefined,
): string[] | null {
  const { after_round, drivers: standings } = event.standings;
  const round = event.meta.round;
  if (round == null || !standings.length) return null;
  let ranked = [...standings].sort((a, b) => a.position - b.position);
  if (after_round === round) {
    if (!results?.race) return null;
    const points = new Map(ranked.map((d) => [d.driver_id, d.points]));
    for (const r of [...results.race, ...(results.sprint ?? [])])
      points.set(r.driver_id, (points.get(r.driver_id) ?? 0) - r.points);
    ranked = ranked.sort(
      (a, b) => points.get(b.driver_id)! - points.get(a.driver_id)!,
    );
  } else if (after_round !== round - 1) return null;
  const entered = new Set(event.drivers.map((d) => d.id));
  const placed = ranked.map((d) => d.driver_id).filter((id) => entered.has(id));
  return [...placed, ...[...entered].filter((id) => !placed.includes(id))];
}

/**
 * What each session classified: the championship going in, then every session of the
 * weekend. Columns after the viewed stage are `future`; the viewed stage's is `selected`.
 */
export function sessionColumns(
  event: EventDoc,
  results: ResultsDoc | undefined,
  viewed: Stage,
): BumpColumn[] {
  const view = { order: STAGE_ORDER[event.format], viewed, selected: viewed };
  const pre = standingsBefore(event, results);
  return [
    stageColumn(
      "pre_weekend",
      pre && {
        order: pre,
        tip: "Championship standings going into the weekend.",
      },
      view,
    ),
    ...event.sessions.map((s) =>
      stageColumn(s.id, results ? CLASSIFICATION[s.id](results) : null, view),
    ),
  ];
}

/**
 * The race finishing-order prediction at every stage before the race, then the result.
 * `shown` is the stage of the snapshot on display, which is the last pre-race one while
 * the race stage is viewed.
 */
export function trendColumns(
  format: WeekendFormat,
  snapshots: FinishingSnapshots,
  results: ResultsDoc | undefined,
  viewed: Stage,
  shown: Stage,
): BumpColumn[] {
  const view = { order: STAGE_ORDER[format], viewed, selected: shown };
  const predicted = (stage: Stage) => {
    const doc = snapshots[stage];
    return doc ? { order: predictedOrder(doc) } : null;
  };
  return [
    ...view.order
      .filter((stage) => stage !== RACE)
      .map((stage) => stageColumn(stage, predicted(stage), view)),
    stageColumn(
      RACE,
      results ? CLASSIFICATION.R(results) : null,
      view,
      "Result",
    ),
  ];
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
