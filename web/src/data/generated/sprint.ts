// Generated from docs/schema/sprint.schema.json by scripts/gen-types.mjs. Do not edit.

export type SchemaVersion = string;
export type Artifact =
  | "index"
  | "manifest"
  | "event"
  | "weather"
  | "finishing_order"
  | "qualifying"
  | "sprint_qualifying"
  | "sprint"
  | "race_incidents"
  | "strategy"
  | "facts"
  | "results";
export type Season = number;
export type Round = number | null;
export type Stage = ("pre_weekend" | "FP1" | "FP2" | "FP3" | "SQ" | "S" | "Q" | "R") | null;
export type GeneratedAt = string;
export type RunId = string;
export type Name = string;
export type Version = string;
export type TrainedThrough = string;
export type Features = string[];
export type Calibrated = boolean;
export type Name1 = string;
export type Value = number;
export type LowerIsBetter = boolean;
export type BaselineName = string | null;
export type BaselineValue = number | null;
export type EvaluatedOn = string;
export type Backtest = Metric[];
export type DriverId = string;
export type GridPosition = number | null;
export type PositionProbs = number[];
export type PDnf = number;
export type PWin = number;
export type PPodium = number;
export type PPoints = number;
export type ExpectedPositionIfClassified = number | null;
export type Drivers = DriverFinishPrediction[];

/**
 * Same shape as finishing_order, for the sprint. Not applicable on a conventional weekend.
 */
export interface SprintDoc {
  meta: Meta;
  model: ModelInfo;
  drivers: Drivers;
}
/**
 * This interface was referenced by `SprintDoc`'s JSON-Schema
 * via the `definition` "Meta".
 */
export interface Meta {
  schema_version?: SchemaVersion;
  artifact: Artifact;
  season: Season;
  round?: Round;
  stage?: Stage;
  generated_at: GeneratedAt;
  run_id: RunId;
}
/**
 * This interface was referenced by `SprintDoc`'s JSON-Schema
 * via the `definition` "ModelInfo".
 */
export interface ModelInfo {
  name: Name;
  version: Version;
  trained_through: TrainedThrough;
  features?: Features;
  calibrated: Calibrated;
  backtest?: Backtest;
}
/**
 * This interface was referenced by `SprintDoc`'s JSON-Schema
 * via the `definition` "Metric".
 */
export interface Metric {
  name: Name1;
  value: Value;
  lower_is_better: LowerIsBetter;
  baseline_name?: BaselineName;
  baseline_value?: BaselineValue;
  evaluated_on: EvaluatedOn;
}
/**
 * This interface was referenced by `SprintDoc`'s JSON-Schema
 * via the `definition` "DriverFinishPrediction".
 */
export interface DriverFinishPrediction {
  driver_id: DriverId;
  grid_position?: GridPosition;
  position_probs: PositionProbs;
  p_dnf: PDnf;
  p_win: PWin;
  p_podium: PPodium;
  p_points: PPoints;
  expected_position_if_classified: ExpectedPositionIfClassified;
}
