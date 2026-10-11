// Generated from docs/schema/facts.schema.json by scripts/gen-types.mjs. Do not edit.

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
export type Id = string;
export type Category =
  "driver" | "team" | "circuit" | "history" | "telemetry" | "weekend";
export type Headline = string;
export type Body = string | null;
export type DriverIds = string[];
export type TeamIds = string[];
export type Source = string;
export type Facts = Fact[];

export interface FactsDoc {
  meta: Meta;
  facts: Facts;
}
/**
 * This interface was referenced by `FactsDoc`'s JSON-Schema
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
 * This interface was referenced by `FactsDoc`'s JSON-Schema
 * via the `definition` "Fact".
 */
export interface Fact {
  id: Id;
  category: Category;
  headline: Headline;
  body?: Body;
  driver_ids?: DriverIds;
  team_ids?: TeamIds;
  source: Source;
}
