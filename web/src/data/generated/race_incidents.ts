// Generated from docs/schema/race_incidents.schema.json by scripts/gen-types.mjs. Do not edit.

export type SchemaVersion = string;
export type Artifact =
  | "index"
  | "manifest"
  | "event"
  | "weather"
  | "finishing_order"
  | "qualifying"
  | "race_incidents"
  | "strategy"
  | "facts"
  | "results";
export type Season = number;
export type Round = number | null;
export type Stage =
  ("pre_weekend" | "FP1" | "FP2" | "FP3" | "SQ" | "S" | "Q" | "R") | null;
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
export type PSafetyCar = number;
export type PVsc = number;
export type PRedFlag = number;
export type ExpectedSafetyCars = number;
export type StartLap = number;
export type EndLap = number;
export type PSafetyCar1 = number;
export type ByLapWindow = LapWindow[];
export type Season1 = number;
export type SafetyCars = number;
export type Vscs = number;
export type RedFlags = number;
export type CircuitHistory = CircuitIncidentHistory[];

export interface RaceIncidentsDoc {
  meta: Meta;
  model: ModelInfo;
  p_safety_car: PSafetyCar;
  p_vsc: PVsc;
  p_red_flag: PRedFlag;
  expected_safety_cars: ExpectedSafetyCars;
  by_lap_window: ByLapWindow;
  circuit_history?: CircuitHistory;
}
/**
 * This interface was referenced by `RaceIncidentsDoc`'s JSON-Schema
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
 * This interface was referenced by `RaceIncidentsDoc`'s JSON-Schema
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
 * This interface was referenced by `RaceIncidentsDoc`'s JSON-Schema
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
 * This interface was referenced by `RaceIncidentsDoc`'s JSON-Schema
 * via the `definition` "LapWindow".
 */
export interface LapWindow {
  start_lap: StartLap;
  end_lap: EndLap;
  p_safety_car: PSafetyCar1;
}
/**
 * This interface was referenced by `RaceIncidentsDoc`'s JSON-Schema
 * via the `definition` "CircuitIncidentHistory".
 */
export interface CircuitIncidentHistory {
  season: Season1;
  safety_cars: SafetyCars;
  vscs: Vscs;
  red_flags: RedFlags;
}
