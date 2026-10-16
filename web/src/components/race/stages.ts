import type { SectionStatus, Stage, WeekendFormat } from "@/data/types";

export const STAGE_ORDER: Record<WeekendFormat, Stage[]> = {
  conventional: ["pre_weekend", "FP1", "FP2", "FP3", "Q", "R"],
  sprint_qualifying: ["pre_weekend", "FP1", "SQ", "S", "Q", "R"],
};

export const STAGE_LABEL: Record<Stage, string> = {
  pre_weekend: "Pre",
  FP1: "FP1",
  FP2: "FP2",
  FP3: "FP3",
  SQ: "Sprint Q",
  S: "Sprint",
  Q: "Quali",
  R: "Race",
};

export const RACE: Stage = "R";

/** The one test for "has not happened yet, seen from `reference`", used by every chart column and strip tile. */
export const isAfter = (
  order: readonly Stage[],
  stage: Stage,
  reference: Stage,
) => order.indexOf(stage) > order.indexOf(reference);

/**
 * What a stage tile offers: a prediction snapshot to open, a stage that ran with no
 * snapshot published, or a stage the weekend has not reached.
 */
export type TileState = "snapshot" | "no_data" | "upcoming";

export interface StageTile {
  stage: Stage;
  state: TileState;
}

/**
 * One tile per stage of the format. The race has no snapshot of its own: once it has run,
 * its tile opens the last prediction made before it.
 */
export function stageTiles(
  format: WeekendFormat,
  current: Stage,
  section: Pick<SectionStatus, "history" | "stage"> | undefined,
): StageTile[] {
  const order = STAGE_ORDER[format];
  const have = new Set<Stage>(section?.history ?? []);
  if (section?.stage) have.add(section.stage);
  return order.map((stage) => ({
    stage,
    state: isAfter(order, stage, current)
      ? "upcoming"
      : have.has(stage) || (stage === RACE && have.size > 0)
        ? "snapshot"
        : "no_data",
  }));
}
