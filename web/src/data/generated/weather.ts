// Generated from docs/schema/weather.schema.json by scripts/gen-types.mjs. Do not edit.

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
export type Source = string;
export type IssuedAt = string | null;
export type SessionId = "FP1" | "FP2" | "FP3" | "SQ" | "S" | "Q" | "R";
export type StartUtc = string;
export type AirTempC = number;
export type PRain = number;
export type WindSpeedMs = number;
export type AirTempCMean = number;
export type TrackTempCMax = number;
export type TrackTempCMin = number | null;
export type HumidityMean = number;
export type WindSpeedMsMean = number;
export type RainShare = number;
export type WetTyreShare = number | null;
export type Sessions = SessionWeather[];
export type TimeUtc = string;
export type AirTempC1 = number;
export type PRain1 = number;
export type RainMm = number;
export type WindSpeedMs1 = number;
export type WindDirDeg = number;
export type Humidity = number;
export type Hourly = HourlyForecast[];
export type Seasons = number[];
export type WetRaceShare = number;
export type AirTempCMean1 = number;
export type TrackTempCMean = number;

/**
 * Refreshed on a timer, not per session -- forecasts move independently of timing data.
 */
export interface WeatherDoc {
  meta: Meta;
  source: Source;
  issued_at: IssuedAt;
  sessions: Sessions;
  hourly: Hourly;
  climatology?: Climatology | null;
}
/**
 * This interface was referenced by `WeatherDoc`'s JSON-Schema
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
 * This interface was referenced by `WeatherDoc`'s JSON-Schema
 * via the `definition` "SessionWeather".
 */
export interface SessionWeather {
  session_id: SessionId;
  start_utc: StartUtc;
  forecast?: SessionForecast | null;
  observed?: ObservedWeather | null;
}
/**
 * This interface was referenced by `WeatherDoc`'s JSON-Schema
 * via the `definition` "SessionForecast".
 */
export interface SessionForecast {
  air_temp_c: AirTempC;
  p_rain: PRain;
  wind_speed_ms: WindSpeedMs;
}
/**
 * Summary of FastF1 Session.weather_data, filled once the session has run.
 *
 * This interface was referenced by `WeatherDoc`'s JSON-Schema
 * via the `definition` "ObservedWeather".
 */
export interface ObservedWeather {
  air_temp_c_mean: AirTempCMean;
  track_temp_c_max: TrackTempCMax;
  track_temp_c_min?: TrackTempCMin;
  humidity_mean: HumidityMean;
  wind_speed_ms_mean: WindSpeedMsMean;
  rain_share: RainShare;
  wet_tyre_share?: WetTyreShare;
}
/**
 * This interface was referenced by `WeatherDoc`'s JSON-Schema
 * via the `definition` "HourlyForecast".
 */
export interface HourlyForecast {
  time_utc: TimeUtc;
  air_temp_c: AirTempC1;
  p_rain: PRain1;
  rain_mm: RainMm;
  wind_speed_ms: WindSpeedMs1;
  wind_dir_deg: WindDirDeg;
  humidity: Humidity;
}
/**
 * Historical prior for this circuit, from the earlier races here the lakehouse holds.
 *
 * This interface was referenced by `WeatherDoc`'s JSON-Schema
 * via the `definition` "Climatology".
 */
export interface Climatology {
  seasons: Seasons;
  wet_race_share: WetRaceShare;
  air_temp_c_mean: AirTempCMean1;
  track_temp_c_mean: TrackTempCMean;
}
