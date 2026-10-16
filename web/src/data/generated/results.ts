// Generated from docs/schema/results.schema.json by scripts/gen-types.mjs. Do not edit.

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
export type SprintQualifying = QualiRow[] | null;
export type DriverId = string;
export type Position = number;
export type Q1S = number | null;
export type Q2S = number | null;
export type Q3S = number | null;
export type Qualifying = QualiRow[] | null;
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
export type RaceNeutralisations = Neutralisation[] | null;
export type Kind = "SC" | "VSC" | "RED";
export type StartLap = number;
export type EndLap = number;
export type RaceStrategies = DriverStrategy[] | null;
export type DriverId2 = string;
/**
 * @minItems 1
 */
export type Stints = [Stint, ...Stint[]];
export type Compound = "SOFT" | "MEDIUM" | "HARD" | "INTERMEDIATE" | "WET";
export type StartLap1 = number;
export type EndLap1 = number;
export type RacePace = DriverPace[] | null;
export type DriverId3 = string;
export type LapTimesS = number[];
export type Compounds = ("SOFT" | "MEDIUM" | "HARD" | "INTERMEDIATE" | "WET")[];

/**
 * Actual outcomes, filled in session by session. Also the ground truth for grading snapshots.
 */
export interface ResultsDoc {
  meta: Meta;
  sprint_qualifying?: SprintQualifying;
  qualifying?: Qualifying;
  sprint?: Sprint;
  race?: Race;
  race_incidents?: IncidentCounts | null;
  race_neutralisations?: RaceNeutralisations;
  race_strategies?: RaceStrategies;
  race_pace?: RacePace;
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
 * One period of a race under the safety car, the virtual safety car or a red flag, in the
 * leader's laps. Every lap the status was active in counts, so an SC deployed late in lap 12
 * and in for laps 13-16 is 12-16.
 *
 * This interface was referenced by `ResultsDoc`'s JSON-Schema
 * via the `definition` "Neutralisation".
 */
export interface Neutralisation {
  kind: Kind;
  start_lap: StartLap;
  end_lap: EndLap;
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
  start_lap: StartLap1;
  end_lap: EndLap1;
}
/**
 * This interface was referenced by `ResultsDoc`'s JSON-Schema
 * via the `definition` "DriverPace".
 */
export interface DriverPace {
  driver_id: DriverId3;
  lap_times_s: LapTimesS;
  compounds?: Compounds;
}
