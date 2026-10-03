"""Artifact schema -- the contract between the Python pipeline and the dashboard.

The pipeline writes these documents as static JSON; the front end only ever reads them.
File layout, refresh lifecycle and design rationale: docs/artifact-schema.md.

Conventions enforced here:
- Probabilities and shares are fractions in [0, 1], never percentages.
- Units live in field names: _s seconds, _c Celsius, _ms metres/second, _mm, _km, _deg.
- Datetimes are timezone-aware UTC.
- Drivers and teams are referenced by Ergast ids (driverId / constructorId). Only
  event.json carries names, numbers and colours.
- Nothing assumes a 20-car field: 2026 has 22 entrants.

CLI:
    python -m src.schema export docs/schema         # JSON Schema for front-end types
    python -m src.schema check <site_root>/v1/2026/16   # validate one published round
"""

from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path
from typing import Annotated, ClassVar, Literal

from pydantic import (AwareDatetime, BaseModel, ConfigDict, Field, ValidationError,
                      computed_field, model_validator)

SCHEMA_VERSION = "1.0.0"

# Slack for probability sums coming out of Monte Carlo runs and float arithmetic.
PROB_TOL = 1e-6

Fraction = Annotated[float, Field(ge=0.0, le=1.0)]
DriverId = Annotated[str, Field(pattern=r"^[a-z0-9_]+$")]  # Ergast driverId, "max_verstappen"
TeamId = Annotated[str, Field(pattern=r"^[a-z0-9_]+$")]  # Ergast constructorId, "red_bull"
HexColor = Annotated[str, Field(pattern=r"^#[0-9a-fA-F]{6}$")]
Slug = Annotated[str, Field(pattern=r"^[a-z0-9][a-z0-9_-]*$")]

EventFormat = Literal["conventional", "sprint_qualifying"]
SessionId = Literal["FP1", "FP2", "FP3", "SQ", "S", "Q", "R"]
# Last session whose data the pipeline has ingested. Session ids match FastF1.
Stage = Literal["pre_weekend", "FP1", "FP2", "FP3", "SQ", "S", "Q", "R"]
Compound = Literal["SOFT", "MEDIUM", "HARD", "INTERMEDIATE", "WET"]
DryCompound = Literal["SOFT", "MEDIUM", "HARD"]

STAGE_ORDER: dict[str, list[str]] = {
    "conventional": ["pre_weekend", "FP1", "FP2", "FP3", "Q", "R"],
    "sprint_qualifying": ["pre_weekend", "FP1", "SQ", "S", "Q", "R"],
}
DRY_COMPOUNDS = {"SOFT", "MEDIUM", "HARD"}

ArtifactName = Literal["index", "manifest", "event", "weather", "finishing_order",
                       "qualifying", "race_incidents", "strategy", "facts", "results"]
SectionName = Literal["event", "weather", "finishing_order", "qualifying",
                      "race_incidents", "strategy", "facts", "results"]
SECTIONS: tuple[str, ...] = SectionName.__args__
# Sections that keep one snapshot per stage at <section>/<stage>.json.
SNAPSHOT_SECTIONS = ("finishing_order", "qualifying", "race_incidents", "strategy")


def round_dir(season: int, rnd: int) -> str:
    """Round directory relative to the v1 root, e.g. '2026/16'."""
    return f"{season}/{rnd:02d}"


def section_path(section: str, stage: str) -> str:
    """Where a section's document lives relative to its round directory."""
    return f"{section}/{stage}.json" if section in SNAPSHOT_SECTIONS else f"{section}.json"


# ---------------------------------------------------------------- base


class Strict(BaseModel):
    """Rejects unknown fields so a typo in the pipeline fails loudly, not silently."""

    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="before")
    @classmethod
    def _drop_computed(cls, data):
        # Computed fields are written out for the front end's convenience but are
        # always re-derived on read, so a round trip through JSON validates cleanly.
        if isinstance(data, dict) and cls.model_computed_fields:
            data = {k: v for k, v in data.items() if k not in cls.model_computed_fields}
        return data


class Meta(Strict):
    schema_version: str = SCHEMA_VERSION
    artifact: ArtifactName
    season: int = Field(ge=1950)
    round: int | None = Field(default=None, ge=1)  # None only on the season index
    stage: Stage | None = None  # None only on the season index
    generated_at: AwareDatetime
    run_id: str  # traces a file back to the pipeline run that wrote it

    @model_validator(mode="after")
    def _round_scoped(self):
        if self.artifact != "index" and (self.round is None or self.stage is None):
            raise ValueError(f"'{self.artifact}' documents need both round and stage")
        return self


class Document(Strict):
    ARTIFACT: ClassVar[str]
    meta: Meta

    @model_validator(mode="after")
    def _artifact_matches(self):
        if self.meta.artifact != self.ARTIFACT:
            raise ValueError(f"meta.artifact is '{self.meta.artifact}', expected '{self.ARTIFACT}'")
        return self


def _unique(values, label):
    values = list(values)
    dupes = sorted({v for v in values if values.count(v) > 1})
    if dupes:
        raise ValueError(f"duplicate {label}: {dupes}")


def _check_stints(stints, race_laps=None):
    if stints[0].start_lap != 1:
        raise ValueError("first stint must start on lap 1")
    for prev, nxt in zip(stints, stints[1:]):
        if nxt.start_lap != prev.end_lap + 1:
            raise ValueError(f"stints not contiguous at lap {prev.end_lap}")
    if race_laps is not None and stints[-1].end_lap != race_laps:
        raise ValueError(f"last stint ends on lap {stints[-1].end_lap}, race is {race_laps} laps")


# ---------------------------------------------------------------- index.json


class RoundSummary(Strict):
    round: int = Field(ge=1)
    event_name: str
    country: str
    circuit_id: str
    format: EventFormat
    race_start_utc: AwareDatetime
    status: Literal["upcoming", "current", "completed", "cancelled"]
    manifest_path: str | None = None  # relative to the v1 root; None until first publish


class SeasonIndex(Document):
    """Entry point. The front end fetches this first and follows current_round."""

    ARTIFACT = "index"
    current_round: int | None  # the round the dashboard opens on
    rounds: list[RoundSummary]

    @model_validator(mode="after")
    def _check(self):
        numbers = [r.round for r in self.rounds]
        if numbers != sorted(numbers):
            raise ValueError("rounds must be sorted by round number")
        _unique(numbers, "rounds")
        current = [r.round for r in self.rounds if r.status == "current"]
        if len(current) > 1:
            raise ValueError(f"more than one current round: {current}")
        if self.current_round is not None and current != [self.current_round]:
            raise ValueError("current_round must be the one round with status 'current'")
        return self


# ---------------------------------------------------------------- manifest.json


class SectionStatus(Strict):
    """What the front end should render for one dashboard panel.

    ready          -- fresh document at `path`
    stale          -- last good document at `path`; the latest refresh failed
    pending        -- not produced yet; expected from stage `available_from`
    error          -- failed and there is no earlier document to fall back on
    not_applicable -- does not exist for this weekend
    """

    status: Literal["ready", "stale", "pending", "error", "not_applicable"]
    path: str | None = None  # relative to the round directory
    stage: Stage | None = None  # stage of the document at `path`
    updated_at: AwareDatetime | None = None
    available_from: Stage | None = None
    history: list[Stage] = []  # earlier snapshots, oldest first (snapshot sections only)
    message: str | None = Field(default=None, max_length=200)  # public-safe, shown to users

    @model_validator(mode="after")
    def _check(self):
        has_doc = self.status in ("ready", "stale")
        if has_doc and not (self.path and self.stage and self.updated_at):
            raise ValueError(f"'{self.status}' needs path, stage and updated_at")
        if not has_doc and self.path is not None:
            raise ValueError(f"'{self.status}' must not point at a document")
        if self.status == "pending" and self.available_from is None:
            raise ValueError("'pending' needs available_from")
        if self.status in ("stale", "error") and not self.message:
            raise ValueError(f"'{self.status}' needs a message")
        return self


class RaceManifest(Document):
    """Per-round index. Every section is listed explicitly; the front end never guesses."""

    ARTIFACT = "manifest"
    event_name: str
    format: EventFormat
    race_start_utc: AwareDatetime
    sections: dict[SectionName, SectionStatus]

    @model_validator(mode="after")
    def _check(self):
        missing = set(SECTIONS) - set(self.sections)
        if missing:
            raise ValueError(f"manifest missing sections: {sorted(missing)}")

        order = STAGE_ORDER[self.format]
        if self.meta.stage not in order:
            raise ValueError(f"stage '{self.meta.stage}' does not exist on a {self.format} weekend")
        current = order.index(self.meta.stage)

        for name, sec in self.sections.items():
            for stage in [sec.stage, sec.available_from, *sec.history]:
                if stage is not None and stage not in order:
                    raise ValueError(f"{name}: stage '{stage}' not on a {self.format} weekend")
            if sec.stage is not None and order.index(sec.stage) > current:
                raise ValueError(f"{name}: document stage '{sec.stage}' is ahead of manifest stage")
            if sec.history:
                if name not in SNAPSHOT_SECTIONS:
                    raise ValueError(f"{name}: only snapshot sections keep history")
                idx = [order.index(s) for s in sec.history]
                if idx != sorted(set(idx)) or (sec.stage and idx[-1] >= order.index(sec.stage)):
                    raise ValueError(f"{name}: history must be strictly before the current snapshot")
            if sec.path is not None and sec.path != section_path(name, sec.stage):
                raise ValueError(f"{name}: path must be '{section_path(name, sec.stage)}'")
        return self


# ---------------------------------------------------------------- event.json


class Team(Strict):
    id: TeamId
    name: str
    color: HexColor


class Driver(Strict):
    id: DriverId
    code: str = Field(pattern=r"^[A-Z]{3}$")
    number: int = Field(ge=0, le=99)
    first_name: str
    last_name: str
    team_id: TeamId
    headshot_url: str | None = None


class Session(Strict):
    id: SessionId
    name: str
    start_utc: AwareDatetime
    status: Literal["upcoming", "live", "completed", "cancelled"]


class Corner(Strict):
    number: int = Field(ge=1)
    letter: str = ""
    x: Fraction
    y: Fraction


class PastWinner(Strict):
    season: int
    driver_name: str  # names, not ids: past drivers are not in this event's entry list
    team_name: str


class Circuit(Strict):
    id: str  # Ergast circuitId
    name: str
    locality: str
    country: str
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    length_km: float | None = Field(default=None, gt=0)
    race_laps: int | None = Field(default=None, gt=0)
    # Track map, rotated to broadcast orientation and scaled into the unit square with
    # aspect ratio preserved. The front end draws it as-is -- no geometry client side.
    outline: list[tuple[Fraction, Fraction]] = Field(min_length=3)
    corners: list[Corner]
    past_winners: list[PastWinner] = []  # newest first


class DriverStanding(Strict):
    driver_id: DriverId  # may include drivers not entered this weekend
    position: int = Field(ge=1)
    points: float = Field(ge=0)
    wins: int = Field(ge=0)


class TeamStanding(Strict):
    team_id: TeamId
    position: int = Field(ge=1)
    points: float = Field(ge=0)
    wins: int = Field(ge=0)


class Standings(Strict):
    after_round: int | None  # None before the season opener
    drivers: list[DriverStanding]
    teams: list[TeamStanding]


class EventDoc(Document):
    """Defines every entity other documents refer to. Written Thursday, updated for substitutions."""

    ARTIFACT = "event"
    name: str
    official_name: str
    format: EventFormat
    circuit: Circuit
    sessions: list[Session]
    teams: list[Team]
    drivers: list[Driver]
    standings: Standings

    @model_validator(mode="after")
    def _check(self):
        expected = STAGE_ORDER[self.format][1:]
        if [s.id for s in self.sessions] != expected:
            raise ValueError(f"{self.format} weekend sessions must be {expected}")
        _unique([t.id for t in self.teams], "team ids")
        _unique([d.id for d in self.drivers], "driver ids")
        _unique([d.code for d in self.drivers], "driver codes")
        _unique([d.number for d in self.drivers], "driver numbers")
        team_ids = {t.id for t in self.teams}
        unknown = {d.team_id for d in self.drivers} - team_ids
        if unknown:
            raise ValueError(f"drivers reference unknown teams: {sorted(unknown)}")
        empty = team_ids - {d.team_id for d in self.drivers}
        if empty:
            raise ValueError(f"teams without drivers: {sorted(empty)}")
        return self


# ---------------------------------------------------------------- weather.json


class HourlyForecast(Strict):
    time_utc: AwareDatetime
    air_temp_c: float
    p_rain: Fraction
    rain_mm: float = Field(ge=0)
    wind_speed_ms: float = Field(ge=0)
    wind_dir_deg: float = Field(ge=0, lt=360)
    humidity: Fraction


class SessionForecast(Strict):
    air_temp_c: float
    p_rain: Fraction
    wind_speed_ms: float = Field(ge=0)


class ObservedWeather(Strict):
    """Summary of FastF1 Session.weather_data, filled once the session has run."""

    air_temp_c_mean: float
    track_temp_c_max: float
    humidity_mean: Fraction
    wind_speed_ms_mean: float = Field(ge=0)
    rain_share: Fraction  # share of samples with Rainfall == True


class SessionWeather(Strict):
    session_id: SessionId
    start_utc: AwareDatetime
    forecast: SessionForecast | None = None
    observed: ObservedWeather | None = None


class Climatology(Strict):
    """Historical prior for this circuit, from FastF1 observed weather in past seasons."""

    seasons: list[int]
    wet_race_share: Fraction  # share of those races with any rainfall
    air_temp_c_mean: float
    track_temp_c_mean: float


class WeatherDoc(Document):
    """Refreshed on a timer, not per session -- forecasts move independently of timing data."""

    ARTIFACT = "weather"
    source: str  # forecast provider, e.g. "open-meteo"
    issued_at: AwareDatetime | None  # when the provider issued the forecast
    sessions: list[SessionWeather]
    hourly: list[HourlyForecast]
    climatology: Climatology | None = None


# ---------------------------------------------------------------- shared prediction parts


class Metric(Strict):
    name: str  # e.g. "brier_win", "top3_hit_rate"
    value: float
    lower_is_better: bool
    baseline_name: str | None = None  # the naive method it has to beat, e.g. "grid_order"
    baseline_value: float | None = None
    evaluated_on: str  # e.g. "2025 season, 24 races, predictions at stage Q"


class ModelInfo(Strict):
    name: str
    version: str
    trained_through: date  # date of the last race in the training data
    features: list[str] = []
    # True only once the probabilities have been checked against held-out outcomes
    # (reliability curve / calibration error). When False the front end must present
    # values as relative model scores, not as chances.
    calibrated: bool
    backtest: list[Metric] = []


class Stint(Strict):
    compound: Compound
    start_lap: int = Field(ge=1)
    end_lap: int = Field(ge=1)

    @model_validator(mode="after")
    def _check(self):
        if self.end_lap < self.start_lap:
            raise ValueError("end_lap before start_lap")
        return self


# ---------------------------------------------------------------- finishing_order/<stage>.json


class DriverFinishPrediction(Strict):
    driver_id: DriverId
    grid_position: int | None = Field(default=None, ge=1)  # known once qualifying is done
    # position_probs[i] = P(classified in position i + 1). Length = number of entrants.
    position_probs: list[Fraction]
    p_dnf: Fraction  # P(not classified)

    @model_validator(mode="after")
    def _check(self):
        total = sum(self.position_probs) + self.p_dnf
        if abs(total - 1) > PROB_TOL:
            raise ValueError(f"{self.driver_id}: position_probs + p_dnf sum to {total:.6f}")
        return self

    @computed_field
    @property
    def p_win(self) -> float:
        return self.position_probs[0]

    @computed_field
    @property
    def p_podium(self) -> float:
        return sum(self.position_probs[:3])

    @computed_field
    @property
    def p_points(self) -> float:
        return sum(self.position_probs[:10])

    @computed_field
    @property
    def expected_position_if_classified(self) -> float | None:
        mass = sum(self.position_probs)
        if mass == 0:
            return None
        return sum((i + 1) * p for i, p in enumerate(self.position_probs)) / mass


class FinishingOrderDoc(Document):
    ARTIFACT = "finishing_order"
    model: ModelInfo
    drivers: list[DriverFinishPrediction]  # in the model's predicted finishing order

    @model_validator(mode="after")
    def _check(self):
        n = len(self.drivers)
        _unique([d.driver_id for d in self.drivers], "driver ids")
        if any(len(d.position_probs) != n for d in self.drivers):
            raise ValueError(f"every position_probs must have one entry per entrant ({n})")
        # Each position is filled at most once per simulated race; lower ones stay
        # empty when cars retire, so column sums fall below 1 but never exceed it.
        for i in range(n):
            col = sum(d.position_probs[i] for d in self.drivers)
            if col > 1 + PROB_TOL:
                raise ValueError(f"P{i + 1} probabilities sum to {col:.6f} (> 1)")
        return self


# ---------------------------------------------------------------- qualifying/<stage>.json


class DriverQualiPrediction(Strict):
    driver_id: DriverId
    position_probs: list[Fraction]  # P(qualifies in position i + 1); every slot is filled

    @model_validator(mode="after")
    def _check(self):
        total = sum(self.position_probs)
        if abs(total - 1) > PROB_TOL:
            raise ValueError(f"{self.driver_id}: position_probs sum to {total:.6f}")
        return self

    @computed_field
    @property
    def p_pole(self) -> float:
        return self.position_probs[0]

    @computed_field
    @property
    def p_top10(self) -> float:
        return sum(self.position_probs[:10])

    @computed_field
    @property
    def expected_position(self) -> float:
        return sum((i + 1) * p for i, p in enumerate(self.position_probs))


class QualifyingDoc(Document):
    """Superseded by results.json once qualifying has run; the manifest keeps it as history."""

    ARTIFACT = "qualifying"
    model: ModelInfo
    drivers: list[DriverQualiPrediction]  # in the model's predicted order

    @model_validator(mode="after")
    def _check(self):
        n = len(self.drivers)
        _unique([d.driver_id for d in self.drivers], "driver ids")
        if any(len(d.position_probs) != n for d in self.drivers):
            raise ValueError(f"every position_probs must have one entry per entrant ({n})")
        for i in range(n):
            col = sum(d.position_probs[i] for d in self.drivers)
            if abs(col - 1) > PROB_TOL:
                raise ValueError(f"grid slot {i + 1} probabilities sum to {col:.6f}")
        return self


# ---------------------------------------------------------------- race_incidents/<stage>.json


class LapWindow(Strict):
    start_lap: int = Field(ge=1)
    end_lap: int = Field(ge=1)
    p_safety_car: Fraction  # P(a safety car period starts inside this window)


class CircuitIncidentHistory(Strict):
    season: int
    safety_cars: int = Field(ge=0)
    vscs: int = Field(ge=0)
    red_flags: int = Field(ge=0)


class RaceIncidentsDoc(Document):
    ARTIFACT = "race_incidents"
    model: ModelInfo
    p_safety_car: Fraction  # P(at least one safety car)
    p_vsc: Fraction  # P(at least one virtual safety car)
    p_red_flag: Fraction
    expected_safety_cars: float = Field(ge=0)
    by_lap_window: list[LapWindow]  # contiguous from lap 1
    circuit_history: list[CircuitIncidentHistory] = []  # the evidence behind the prior, newest first

    @model_validator(mode="after")
    def _check(self):
        # N >= 0 is an integer, so E[N] >= P(N >= 1).
        if self.expected_safety_cars + PROB_TOL < self.p_safety_car:
            raise ValueError("expected_safety_cars cannot be below p_safety_car")
        if self.by_lap_window:
            if self.by_lap_window[0].start_lap != 1:
                raise ValueError("lap windows must start at lap 1")
            for prev, nxt in zip(self.by_lap_window, self.by_lap_window[1:]):
                if nxt.start_lap != prev.end_lap + 1:
                    raise ValueError(f"lap windows not contiguous at lap {prev.end_lap}")
            for w in self.by_lap_window:
                if w.end_lap < w.start_lap:
                    raise ValueError(f"lap window {w.start_lap}-{w.end_lap} is reversed")
                if w.p_safety_car > self.p_safety_car + PROB_TOL:
                    raise ValueError("a lap window cannot be likelier than any safety car at all")
        return self


# ---------------------------------------------------------------- strategy/<stage>.json


class PitWindow(Strict):
    stop: int = Field(ge=1)
    earliest_lap: int = Field(ge=1)
    latest_lap: int = Field(ge=1)


class StrategyOption(Strict):
    id: Slug  # stable across stages, e.g. "1stop-m-h", so the front end can track movers
    stints: list[Stint] = Field(min_length=1)
    expected_time_delta_s: float = Field(ge=0)  # vs the best option, which is 0
    pit_windows: list[PitWindow]
    p_best: Fraction | None = None  # share of simulations in which this option was fastest

    @computed_field
    @property
    def stops(self) -> int:
        return len(self.stints) - 1

    @model_validator(mode="after")
    def _check(self):
        _check_stints(self.stints)
        if len(self.pit_windows) != len(self.stints) - 1:
            raise ValueError(f"{self.id}: needs one pit window per stop")
        compounds = {s.compound for s in self.stints}
        if compounds <= DRY_COMPOUNDS and len(compounds) < 2:
            raise ValueError(f"{self.id}: a dry race must use at least two dry compounds")
        return self


class DegradationCurve(Strict):
    compound: Compound
    tyre_life: list[int]  # laps on the tyre
    lap_delta_s: list[float]  # lap time loss vs a fresh tyre, fuel-corrected
    source_sessions: list[SessionId]  # e.g. ["FP2"] long runs

    @model_validator(mode="after")
    def _check(self):
        if len(self.tyre_life) != len(self.lap_delta_s):
            raise ValueError(f"{self.compound}: tyre_life and lap_delta_s differ in length")
        return self


class StrategyDoc(Document):
    ARTIFACT = "strategy"
    model: ModelInfo
    race_laps: int = Field(gt=0)
    pit_loss_s: float = Field(gt=0)  # time lost per stop, pit lane entry to exit
    # Pirelli allocation, e.g. {"SOFT": "C5"}. Not in FastF1 -- None when unknown.
    compounds_available: dict[DryCompound, str] | None = None
    options: list[StrategyOption] = Field(min_length=1)  # best first
    degradation: list[DegradationCurve] = []

    @model_validator(mode="after")
    def _check(self):
        _unique([o.id for o in self.options], "option ids")
        for o in self.options:
            _check_stints(o.stints, self.race_laps)
        deltas = [o.expected_time_delta_s for o in self.options]
        if deltas != sorted(deltas) or deltas[0] != 0:
            raise ValueError("options must be sorted best first, with the best at delta 0")
        p_best = [o.p_best for o in self.options if o.p_best is not None]
        if sum(p_best) > 1 + PROB_TOL:
            raise ValueError("p_best values sum to more than 1")
        return self


# ---------------------------------------------------------------- facts.json


class Fact(Strict):
    id: Slug  # stable across refreshes so the front end can dedupe
    category: Literal["driver", "team", "circuit", "history", "telemetry", "weekend"]
    headline: str = Field(max_length=100)
    body: str | None = Field(default=None, max_length=400)
    driver_ids: list[DriverId] = []
    team_ids: list[TeamId] = []
    source: str  # provenance, e.g. "fastf1 2025 R16 race telemetry"


class FactsDoc(Document):
    ARTIFACT = "facts"
    facts: list[Fact]

    @model_validator(mode="after")
    def _check(self):
        _unique([f.id for f in self.facts], "fact ids")
        return self


# ---------------------------------------------------------------- results.json


class QualiRow(Strict):
    driver_id: DriverId
    position: int = Field(ge=1)
    q1_s: float | None = None
    q2_s: float | None = None
    q3_s: float | None = None


class RaceRow(Strict):
    driver_id: DriverId
    grid: int | None = Field(default=None, ge=1)  # None = pit lane start
    position: int | None = Field(default=None, ge=1)  # None if not classified
    classified_as: str  # FastF1 ClassifiedPosition: "1".."22", or R / D / E / W / N
    status: str  # FastF1 Status, e.g. "Finished", "+1 Lap", "Engine"
    points: float = Field(ge=0)
    laps: int = Field(ge=0)

    @model_validator(mode="after")
    def _check(self):
        if self.classified_as.isdigit():
            if self.position != int(self.classified_as):
                raise ValueError(f"{self.driver_id}: position disagrees with classified_as")
        elif self.classified_as in ("R", "D", "E", "W", "N", "F"):
            if self.position is not None:
                raise ValueError(f"{self.driver_id}: unclassified driver has a position")
        else:
            raise ValueError(f"{self.driver_id}: unknown classified_as '{self.classified_as}'")
        return self


class IncidentCounts(Strict):
    safety_cars: int = Field(ge=0)
    vscs: int = Field(ge=0)
    red_flags: int = Field(ge=0)


class DriverStrategy(Strict):
    driver_id: DriverId
    stints: list[Stint] = Field(min_length=1)


class ResultsDoc(Document):
    """Actual outcomes, filled in session by session. Also the ground truth for grading snapshots."""

    ARTIFACT = "results"
    qualifying: list[QualiRow] | None = None
    sprint: list[RaceRow] | None = None
    race: list[RaceRow] | None = None
    race_incidents: IncidentCounts | None = None
    race_strategies: list[DriverStrategy] | None = None

    @model_validator(mode="after")
    def _check(self):
        for label, rows in (("qualifying", self.qualifying), ("sprint", self.sprint), ("race", self.race)):
            if rows:
                _unique([r.driver_id for r in rows], f"{label} driver ids")
        for s in self.race_strategies or []:
            _check_stints(s.stints)
        return self


# ---------------------------------------------------------------- registry + cross-file checks

DOCUMENTS: dict[str, type[Document]] = {
    cls.ARTIFACT: cls
    for cls in (SeasonIndex, RaceManifest, EventDoc, WeatherDoc, FinishingOrderDoc,
                QualifyingDoc, RaceIncidentsDoc, StrategyDoc, FactsDoc, ResultsDoc)
}


def load(path: Path, artifact: str) -> Document:
    return DOCUMENTS[artifact].model_validate_json(Path(path).read_text())


def check_round(directory: Path) -> list[str]:
    """Validate one round directory as a whole. Empty list means safe to publish.

    Per-document validation catches malformed files; this catches documents that are
    each valid but disagree with each other (unknown driver ids, missing snapshots,
    a manifest pointing at a stage the file isn't at).
    """
    directory = Path(directory)
    errors: list[str] = []

    def read(rel, artifact):
        try:
            return load(directory / rel, artifact)
        except FileNotFoundError:
            errors.append(f"{rel}: listed in manifest but missing")
        except ValidationError as exc:
            errors.append(f"{rel}: {exc.error_count()} validation error(s)\n{exc}")
        return None

    manifest = read("manifest.json", "manifest")
    if manifest is None:
        return errors

    docs: dict[str, Document] = {}
    for name, sec in manifest.sections.items():
        if sec.path is None:
            continue
        doc = read(sec.path, name)
        if doc is None:
            continue
        docs[name] = doc
        if (doc.meta.season, doc.meta.round) != (manifest.meta.season, manifest.meta.round):
            errors.append(f"{sec.path}: season/round differ from manifest")
        if doc.meta.stage != sec.stage:
            errors.append(f"{sec.path}: file is at stage '{doc.meta.stage}', manifest says '{sec.stage}'")
        for stage in sec.history:
            if not (directory / section_path(name, stage)).exists():
                errors.append(f"{name}: history snapshot '{stage}' missing")

    event = docs.get("event")
    if event is None:
        errors.append("event.json is required to resolve driver and team ids")
        return errors

    drivers = {d.id for d in event.drivers}
    teams = {t.id for t in event.teams}

    for name in ("finishing_order", "qualifying"):
        if name in docs:
            predicted = {d.driver_id for d in docs[name].drivers}
            if predicted != drivers:
                errors.append(f"{name}: predicted field differs from entry list "
                              f"(missing {sorted(drivers - predicted)}, extra {sorted(predicted - drivers)})")

    if "facts" in docs:
        for fact in docs["facts"].facts:
            if set(fact.driver_ids) - drivers or set(fact.team_ids) - teams:
                errors.append(f"facts: '{fact.id}' references ids outside the entry list")

    if "results" in docs:
        res = docs["results"]
        rows = [*(res.qualifying or []), *(res.sprint or []), *(res.race or []), *(res.race_strategies or [])]
        unknown = {r.driver_id for r in rows} - drivers
        if unknown:
            errors.append(f"results: unknown driver ids {sorted(unknown)}")

    laps = event.circuit.race_laps
    if "strategy" in docs and laps is not None and docs["strategy"].race_laps != laps:
        errors.append(f"strategy: race_laps {docs['strategy'].race_laps} != circuit race_laps {laps}")

    return errors


def export_json_schema(out_dir: Path) -> list[Path]:
    """Write one JSON Schema per document type, in serialization mode so computed
    fields (p_win, stops, ...) appear in the generated front-end types."""
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    written = []
    for artifact, cls in DOCUMENTS.items():
        path = out_dir / f"{artifact}.schema.json"
        schema = cls.model_json_schema(mode="serialization")
        schema["$id"] = f"race-preds/v{SCHEMA_VERSION.split('.')[0]}/{artifact}"
        path.write_text(json.dumps(schema, indent=2) + "\n")
        written.append(path)
    return written


if __name__ == "__main__":
    usage = "usage: python -m src.schema export <dir> | check <round_dir>"
    if len(sys.argv) != 3 or sys.argv[1] not in ("export", "check"):
        sys.exit(usage)

    command, target = sys.argv[1], Path(sys.argv[2])
    if command == "export":
        for p in export_json_schema(target):
            print(f"wrote {p}")
    else:
        problems = check_round(target)
        for problem in problems:
            print(f"✗ {problem}")
        print(f"{target}: {'OK' if not problems else f'{len(problems)} problem(s)'}")
        sys.exit(1 if problems else 0)
