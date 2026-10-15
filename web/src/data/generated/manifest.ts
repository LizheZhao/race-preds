// Generated from docs/schema/manifest.schema.json by scripts/gen-types.mjs. Do not edit.

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
export type EventName = string;
export type Format = "conventional" | "sprint_qualifying";
export type RaceStartUtc = string;
export type Status = "ready" | "stale" | "pending" | "error" | "not_applicable";
export type Path = string | null;
export type Stage1 = ("pre_weekend" | "FP1" | "FP2" | "FP3" | "SQ" | "S" | "Q" | "R") | null;
export type UpdatedAt = string | null;
export type AvailableFrom = ("pre_weekend" | "FP1" | "FP2" | "FP3" | "SQ" | "S" | "Q" | "R") | null;
export type History = ("pre_weekend" | "FP1" | "FP2" | "FP3" | "SQ" | "S" | "Q" | "R")[];
export type Message = string | null;

/**
 * Per-round index. Every section is listed explicitly; the front end never guesses.
 */
export interface RaceManifest {
  meta: Meta;
  event_name: EventName;
  format: Format;
  race_start_utc: RaceStartUtc;
  sections: Sections;
}
/**
 * This interface was referenced by `RaceManifest`'s JSON-Schema
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
export interface Sections {
  [k: string]: SectionStatus;
}
/**
 * What the front end should render for one dashboard panel.
 *
 * ready          -- fresh document at `path`
 * stale          -- last good document at `path`; the latest refresh failed
 * pending        -- not produced yet; expected from stage `available_from`
 * error          -- failed and there is no earlier document to fall back on
 * not_applicable -- does not exist for this weekend
 *
 * This interface was referenced by `RaceManifest`'s JSON-Schema
 * via the `definition` "SectionStatus".
 */
export interface SectionStatus {
  status: Status;
  path?: Path;
  stage?: Stage1;
  updated_at?: UpdatedAt;
  available_from?: AvailableFrom;
  history?: History;
  message?: Message;
}
