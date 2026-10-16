// Friendly names over the types generated from docs/schema (npm run gen:types).
// Never declare document fields by hand here: change src/schema.py, export, regenerate.
import type * as Ev from "./generated/event";
import type * as Fa from "./generated/facts";
import type * as Fo from "./generated/finishing_order";
import type * as Ix from "./generated/index";
import type * as Mf from "./generated/manifest";
import type * as Qu from "./generated/qualifying";
import type * as Ri from "./generated/race_incidents";
import type * as Re from "./generated/results";
import type * as Sp from "./generated/sprint";
import type * as Sq from "./generated/sprint_qualifying";
import type * as St from "./generated/strategy";
import type * as We from "./generated/weather";

export type SeasonIndex = Ix.SeasonIndex;
export type RoundSummary = Ix.RoundSummary;

export type RaceManifest = Mf.RaceManifest;
export type SectionStatus = Mf.SectionStatus;
export type SectionStatusKind = SectionStatus["status"];
export type WeekendFormat = RaceManifest["format"];
export type Stage = NonNullable<Mf.Meta["stage"]>;
export type SectionKey = Exclude<Mf.Meta["artifact"], "index" | "manifest">;

export type EventDoc = Ev.EventDoc;
export type Driver = Ev.Driver;
export type Team = Ev.Team;
export type SessionId = Ev.Session["id"];

export type ModelInfo = Fo.ModelInfo;
export type FinishingOrderDoc = Fo.FinishingOrderDoc;
/** Every published finishing-order snapshot of a round, by the stage it was made at. */
export type FinishingSnapshots = Partial<Record<Stage, FinishingOrderDoc>>;
export type QualifyingDoc = Qu.QualifyingDoc;
export type SprintQualifyingDoc = Sq.SprintQualifyingDoc;
export type SprintDoc = Sp.SprintDoc;
export type RaceIncidentsDoc = Ri.RaceIncidentsDoc;
export type StrategyDoc = St.StrategyDoc;
export type Compound = St.Stint["compound"];
export type WeatherDoc = We.WeatherDoc;
export type FactsDoc = Fa.FactsDoc;
export type ResultsDoc = Re.ResultsDoc;
export type RaceRow = Re.RaceRow;
export type QualiRow = Re.QualiRow;
export type DriverPace = Re.DriverPace;

export type PredictionKey =
  | "finishing_order"
  | "qualifying"
  | "sprint_qualifying"
  | "sprint"
  | "strategy"
  | "race_incidents";
