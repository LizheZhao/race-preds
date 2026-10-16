// Generated from docs/schema/strategy.schema.json by scripts/gen-types.mjs. Do not edit.

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
export type RaceLaps = number;
export type PitLossS = number;
export type PitLossS1 = number;
export type Stops = number;
export type Seasons = number[];
export type CompoundsAvailable = {
  [k: string]: string;
} | null;
/**
 * @minItems 1
 */
export type Options = [StrategyOption, ...StrategyOption[]];
export type Id = string;
/**
 * @minItems 1
 */
export type Stints = [Stint, ...Stint[]];
export type Compound = "SOFT" | "MEDIUM" | "HARD" | "INTERMEDIATE" | "WET";
export type StartLap = number;
export type EndLap = number;
export type ExpectedTimeDeltaS = number;
export type Stop = number;
export type EarliestLap = number;
export type LatestLap = number;
export type PitWindows = PitWindow[];
export type PBest = number | null;
export type Stops1 = number;
export type Compound1 = "SOFT" | "MEDIUM" | "HARD" | "INTERMEDIATE" | "WET";
export type TyreLife = number[];
export type LapDeltaS = number[];
export type SourceSessions = ("FP1" | "FP2" | "FP3" | "SQ" | "S" | "Q" | "R")[];
export type Seasons1 = number[];
export type Stints1 = number | null;
export type Degradation = DegradationCurve[];
export type MeasuredDegradation = DegradationCurve[];

export interface StrategyDoc {
  meta: Meta;
  model: ModelInfo;
  race_laps: RaceLaps;
  pit_loss_s: PitLossS;
  pit_loss_measured?: PitLoss | null;
  compounds_available?: CompoundsAvailable;
  options: Options;
  degradation?: Degradation;
  measured_degradation?: MeasuredDegradation;
}
/**
 * This interface was referenced by `StrategyDoc`'s JSON-Schema
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
 * This interface was referenced by `StrategyDoc`'s JSON-Schema
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
 * This interface was referenced by `StrategyDoc`'s JSON-Schema
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
 * Green-flag stops at this circuit: in-lap plus out-lap against twice the driver's median lap.
 *
 * This interface was referenced by `StrategyDoc`'s JSON-Schema
 * via the `definition` "PitLoss".
 */
export interface PitLoss {
  pit_loss_s: PitLossS1;
  stops: Stops;
  seasons: Seasons;
}
/**
 * This interface was referenced by `StrategyDoc`'s JSON-Schema
 * via the `definition` "StrategyOption".
 */
export interface StrategyOption {
  id: Id;
  stints: Stints;
  expected_time_delta_s: ExpectedTimeDeltaS;
  pit_windows: PitWindows;
  p_best?: PBest;
  stops: Stops1;
}
/**
 * This interface was referenced by `StrategyDoc`'s JSON-Schema
 * via the `definition` "Stint".
 */
export interface Stint {
  compound: Compound;
  start_lap: StartLap;
  end_lap: EndLap;
}
/**
 * This interface was referenced by `StrategyDoc`'s JSON-Schema
 * via the `definition` "PitWindow".
 */
export interface PitWindow {
  stop: Stop;
  earliest_lap: EarliestLap;
  latest_lap: LatestLap;
}
/**
 * This interface was referenced by `StrategyDoc`'s JSON-Schema
 * via the `definition` "DegradationCurve".
 */
export interface DegradationCurve {
  compound: Compound1;
  tyre_life: TyreLife;
  lap_delta_s: LapDeltaS;
  source_sessions: SourceSessions;
  seasons?: Seasons1;
  stints?: Stints1;
}
