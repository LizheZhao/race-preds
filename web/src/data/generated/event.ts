// Generated from docs/schema/event.schema.json by scripts/gen-types.mjs. Do not edit.

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
export type OfficialName = string;
export type Format = "conventional" | "sprint_qualifying";
export type Id = string;
export type Name1 = string;
export type Locality = string;
export type Country = string;
export type Lat = number;
export type Lon = number;
export type LengthKm = number | null;
export type RaceLaps = number | null;
/**
 * @minItems 3
 */
export type Outline = [
  [number, number],
  [number, number],
  [number, number],
  ...[number, number][],
];
export type Number = number;
export type Letter = string;
export type X = number;
export type Y = number;
export type Corners = Corner[];
export type Season1 = number;
export type DriverName = string;
export type TeamName = string;
export type PastWinners = PastWinner[];
export type Id1 = "FP1" | "FP2" | "FP3" | "SQ" | "S" | "Q" | "R";
export type Name2 = string;
export type StartUtc = string;
export type Status = "upcoming" | "live" | "completed" | "cancelled";
export type Sessions = Session[];
export type Id2 = string;
export type Name3 = string;
export type Color = string;
export type Teams = Team[];
export type Id3 = string;
export type Code = string;
export type Number1 = number;
export type FirstName = string;
export type LastName = string;
export type TeamId = string;
export type HeadshotUrl = string | null;
export type Drivers = Driver[];
export type AfterRound = number | null;
export type DriverId = string;
export type Position = number;
export type Points = number;
export type Wins = number;
export type Drivers1 = DriverStanding[];
export type TeamId1 = string;
export type Position1 = number;
export type Points1 = number;
export type Wins1 = number;
export type Teams1 = TeamStanding[];

/**
 * Defines every entity other documents refer to. Written Thursday, updated for substitutions.
 */
export interface EventDoc {
  meta: Meta;
  name: Name;
  official_name: OfficialName;
  format: Format;
  circuit: Circuit;
  sessions: Sessions;
  teams: Teams;
  drivers: Drivers;
  standings: Standings;
}
/**
 * This interface was referenced by `EventDoc`'s JSON-Schema
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
 * This interface was referenced by `EventDoc`'s JSON-Schema
 * via the `definition` "Circuit".
 */
export interface Circuit {
  id: Id;
  name: Name1;
  locality: Locality;
  country: Country;
  lat: Lat;
  lon: Lon;
  length_km?: LengthKm;
  race_laps?: RaceLaps;
  outline: Outline;
  corners: Corners;
  past_winners?: PastWinners;
}
/**
 * This interface was referenced by `EventDoc`'s JSON-Schema
 * via the `definition` "Corner".
 */
export interface Corner {
  number: Number;
  letter?: Letter;
  x: X;
  y: Y;
}
/**
 * This interface was referenced by `EventDoc`'s JSON-Schema
 * via the `definition` "PastWinner".
 */
export interface PastWinner {
  season: Season1;
  driver_name: DriverName;
  team_name: TeamName;
}
/**
 * This interface was referenced by `EventDoc`'s JSON-Schema
 * via the `definition` "Session".
 */
export interface Session {
  id: Id1;
  name: Name2;
  start_utc: StartUtc;
  status: Status;
}
/**
 * This interface was referenced by `EventDoc`'s JSON-Schema
 * via the `definition` "Team".
 */
export interface Team {
  id: Id2;
  name: Name3;
  color: Color;
}
/**
 * This interface was referenced by `EventDoc`'s JSON-Schema
 * via the `definition` "Driver".
 */
export interface Driver {
  id: Id3;
  code: Code;
  number: Number1;
  first_name: FirstName;
  last_name: LastName;
  team_id: TeamId;
  headshot_url?: HeadshotUrl;
}
/**
 * This interface was referenced by `EventDoc`'s JSON-Schema
 * via the `definition` "Standings".
 */
export interface Standings {
  after_round: AfterRound;
  drivers: Drivers1;
  teams: Teams1;
}
/**
 * This interface was referenced by `EventDoc`'s JSON-Schema
 * via the `definition` "DriverStanding".
 */
export interface DriverStanding {
  driver_id: DriverId;
  position: Position;
  points: Points;
  wins: Wins;
}
/**
 * This interface was referenced by `EventDoc`'s JSON-Schema
 * via the `definition` "TeamStanding".
 */
export interface TeamStanding {
  team_id: TeamId1;
  position: Position1;
  points: Points1;
  wins: Wins1;
}
