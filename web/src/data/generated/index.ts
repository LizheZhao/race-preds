// Generated from docs/schema/index.schema.json by scripts/gen-types.mjs. Do not edit.

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
export type CurrentRound = number | null;
export type Round1 = number;
export type EventName = string;
export type Country = string;
export type CircuitId = string;
export type Format = "conventional" | "sprint_qualifying";
export type RaceStartUtc = string;
export type Status = "upcoming" | "current" | "completed" | "cancelled";
export type ManifestPath = string | null;
export type Rounds = RoundSummary[];

/**
 * Entry point. The front end fetches this first and follows current_round.
 */
export interface SeasonIndex {
  meta: Meta;
  current_round: CurrentRound;
  rounds: Rounds;
}
/**
 * This interface was referenced by `SeasonIndex`'s JSON-Schema
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
 * This interface was referenced by `SeasonIndex`'s JSON-Schema
 * via the `definition` "RoundSummary".
 */
export interface RoundSummary {
  round: Round1;
  event_name: EventName;
  country: Country;
  circuit_id: CircuitId;
  format: Format;
  race_start_utc: RaceStartUtc;
  status: Status;
  manifest_path?: ManifestPath;
}
