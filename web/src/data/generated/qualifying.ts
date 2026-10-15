// Generated from docs/schema/qualifying.schema.json by scripts/gen-types.mjs. Do not edit.

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
export type PositionProbs = number[];
export type PPole = number;
export type PTop10 = number;
export type ExpectedPosition = number;
export type Drivers = DriverQualiPrediction[];

/**
 * Superseded by results.json once qualifying has run; the manifest keeps it as history.
 */
export interface QualifyingDoc {
  meta: Meta;
  model: ModelInfo;
  drivers: Drivers;
}
/**
 * This interface was referenced by `QualifyingDoc`'s JSON-Schema
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
 * This interface was referenced by `QualifyingDoc`'s JSON-Schema
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
 * This interface was referenced by `QualifyingDoc`'s JSON-Schema
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
 * This interface was referenced by `QualifyingDoc`'s JSON-Schema
 * via the `definition` "DriverQualiPrediction".
 */
export interface DriverQualiPrediction {
  driver_id: DriverId;
  position_probs: PositionProbs;
  p_pole: PPole;
  p_top10: PTop10;
  expected_position: ExpectedPosition;
}
