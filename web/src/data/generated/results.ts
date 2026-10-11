// Generated from docs/schema/results.schema.json by scripts/gen-types.mjs. Do not edit.

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
export type Qualifying = QualiRow[] | null;
export type DriverId = string;
export type Position = number;
export type Q1S = number | null;
export type Q2S = number | null;
export type Q3S = number | null;
export type Sprint = RaceRow[] | null;
export type DriverId1 = string;
export type Grid = number | null;
export type Position1 = number | null;
export type ClassifiedAs = string;
export type Status = string;
export type Points = number;
export type Laps = number;
export type Race = RaceRow[] | null;
export type SafetyCars = number;
export type Vscs = number;
export type RedFlags = number;
export type RaceStrategies = DriverStrategy[] | null;
export type DriverId2 = string;
/**
 * @minItems 1
 */
export type Stints = [Stint, ...Stint[]];
export type Compound = "SOFT" | "MEDIUM" | "HARD" | "INTERMEDIATE" | "WET";
export type StartLap = number;
export type EndLap = number;

/**
 * Actual outcomes, filled in session by session. Also the ground truth for grading snapshots.
 */
export interface ResultsDoc {
  meta: Meta;
  qualifying?: Qualifying;
  sprint?: Sprint;
  race?: Race;
  race_incidents?: IncidentCounts | null;
  race_strategies?: RaceStrategies;
}
/**
 * This interface was referenced by `ResultsDoc`'s JSON-Schema
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
 * This interface was referenced by `ResultsDoc`'s JSON-Schema
 * via the `definition` "QualiRow".
 */
export interface QualiRow {
  driver_id: DriverId;
  position: Position;
  q1_s?: Q1S;
  q2_s?: Q2S;
  q3_s?: Q3S;
}
/**
 * This interface was referenced by `ResultsDoc`'s JSON-Schema
 * via the `definition` "RaceRow".
 */
export interface RaceRow {
  driver_id: DriverId1;
  grid?: Grid;
  position?: Position1;
  classified_as: ClassifiedAs;
  status: Status;
  points: Points;
  laps: Laps;
}
/**
 * This interface was referenced by `ResultsDoc`'s JSON-Schema
 * via the `definition` "IncidentCounts".
 */
export interface IncidentCounts {
  safety_cars: SafetyCars;
  vscs: Vscs;
  red_flags: RedFlags;
}
/**
 * This interface was referenced by `ResultsDoc`'s JSON-Schema
 * via the `definition` "DriverStrategy".
 */
export interface DriverStrategy {
  driver_id: DriverId2;
  stints: Stints;
}
/**
 * This interface was referenced by `ResultsDoc`'s JSON-Schema
 * via the `definition` "Stint".
 */
export interface Stint {
  compound: Compound;
  start_lap: StartLap;
  end_lap: EndLap;
}
