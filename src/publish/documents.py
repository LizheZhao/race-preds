"""
one schema document per section, for one round at one stage

a Context fixes the round, the stage and the clock. Lakehouse reads are limited to the
sessions usable at the stage, and reference data stops at the previous round, so a replay
of a past weekend publishes what could have been known at that moment
"""
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import NamedTuple

import pandas as pd

from src import schema
from src.config import FIRST_TIMING_SEASON
from src.models import baselines, registry
from src.publish import aggregates as agg
from src.publish import lakehouse as lh
from src.publish import reference as ref
from src.sessions import get_session_stage, get_sessions

BASELINE_VERSION = "baseline-1"
FORECAST_WINDOW = pd.Timedelta(hours=2)  # a session's forecast is the mean over its first two hours


@dataclass(frozen=True)
class Context:
    season: int
    round: int
    stage: str
    now: datetime  # the (replay) clock, UTC
    run_id: str
    sessions: list[dict] = field(default_factory=list)

    @classmethod
    def at(cls, season: int, rnd: int, stage: str, now: datetime, run_id: str) -> "Context":
        return cls(season, rnd, stage, now, run_id, get_sessions(season, rnd))

    @property
    def usable(self) -> list[str]:
        """sessions whose data the pipeline has at this stage"""
        return get_session_stage(self.season, self.round, self.stage)

    @property
    def event_format(self) -> str:
        return ref.event(self.season, self.round)["EventFormat"]

    def meta(self, artifact: str, stage: str | None = None) -> schema.Meta:
        return schema.Meta(artifact=artifact, season=self.season, round=self.round, stage=stage or self.stage,
                           generated_at=self.now, run_id=self.run_id)

    def model(self, name: str, features: list[str]) -> schema.ModelInfo:
        previous = ref.event(self.season, self.round - 1) if self.round > 1 else None
        trained_through = previous["EventDate"].date() if previous is not None else date(self.season - 1, 12, 31)
        return schema.ModelInfo(name=name, version=BASELINE_VERSION, trained_through=trained_through,
                                features=features, calibrated=False)


def utc(ts) -> datetime:
    ts = pd.Timestamp(ts)
    return (ts.tz_localize("UTC") if ts.tzinfo is None else ts.tz_convert("UTC")).to_pydatetime()


def _num(value) -> float | None:
    return None if pd.isna(value) else float(value)


def entries(ctx: Context) -> pd.DataFrame:
    """the field as known at the stage: the latest session run this weekend that the lakehouse
    holds, except FP1 (rookies stand in there), before that the previous round's race"""
    for sid in reversed([sid for sid in ctx.usable if sid != "FP1"]):
        roster = ref.entry_list(ctx.season, ctx.round, sid)
        if len(roster):
            return roster
    roster = ref.entry_list(ctx.season, ctx.round)
    if roster.empty:
        raise LookupError(f"{ctx.season} R{ctx.round - 1} race is not in the lakehouse, no entry list")
    return roster


def _ids(ctx: Context, frame: pd.DataFrame) -> pd.DataFrame:
    """fill driver_id from the field by driver code: silver has no Ergast ids while a weekend is in progress"""
    roster = entries(ctx)
    return frame.assign(driver_id=frame["driver_id"].fillna(frame["driver"].map(dict(zip(roster["code"], roster["driver_id"])))))


def _results(ctx: Context, session_id: str) -> pd.DataFrame:
    return _ids(ctx, lh.results(ctx.season, ctx.round, session_id))


def _earlier_here(ctx: Context) -> list[tuple[int, int]]:
    """(season, round) of every race at this round's circuit before it, as far back as timing data goes"""
    circuit_id = ref.circuit_row(ctx.season, ctx.round)["circuitId"]
    return [(s, r) for s, r in ref.rounds_at(circuit_id, range(FIRST_TIMING_SEASON, ctx.season + 1))
            if (s, r) < (ctx.season, ctx.round)]


def _periods(flags: pd.DataFrame) -> dict[tuple[int, int], list[schema.Neutralisation]]:
    """neutralisation periods per (season, round), in lap order"""
    periods = agg.neutralisations(flags).sort_values(["season", "round", "start_lap", "kind"])
    return {(int(s), int(r)): [schema.Neutralisation(kind=p.kind, start_lap=p.start_lap, end_lap=p.end_lap)
                               for p in g.itertuples()]
            for (s, r), g in periods.groupby(["season", "round"])}


# ---------------------------------------------------------------- event


def event(ctx: Context) -> schema.EventDoc:
    ev, row = ref.event(ctx.season, ctx.round), ref.circuit_row(ctx.season, ctx.round)
    geometry = ref.circuit_geometry(ctx.season, ctx.round, row["circuitId"])
    roster = entries(ctx)
    after_round, drivers_st, teams_st = _standings(ctx)

    team_rank = {t: i for i, t in enumerate(teams_st["constructorId"])} if len(teams_st) else {}
    teams = roster.drop_duplicates("team_id").sort_values("team_id", key=lambda s: s.map(lambda t: team_rank.get(t, 99)))
    color = lambda c: f"#{c}" if isinstance(c, str) and len(c) == 6 else "#808080"

    def status(s: dict) -> str:
        if s["session_id"] in ctx.usable:
            return "completed"
        return "live" if utc(s["session_dt_utc"]) <= ctx.now else "upcoming"

    winners = ref.past_winners(row["circuitId"], ctx.season)
    story = ref.circuit_story(row["circuitId"]) or {}
    named = {c["number"]: c for c in story.get("corners", [])}
    return schema.EventDoc(
        meta=ctx.meta("event"), name=ev["EventName"], official_name=ev["OfficialEventName"], format=ev["EventFormat"],
        circuit=schema.Circuit(
            id=row["circuitId"], name=row["circuitName"], locality=row["locality"], country=row["country"],
            lat=float(row["lat"]), lon=float(row["long"]), length_km=geometry["length_km"],
            race_laps=ref.race_laps(row["circuitId"], ctx.season, geometry["length_km"]),
            outline=[tuple(p) for p in geometry["outline"]],
            corners=[schema.Corner(**c, name=named.get(c["number"], {}).get("name"),
                                   name_origin=named.get(c["number"], {}).get("origin")) for c in geometry["corners"]],
            past_winners=[schema.PastWinner(season=int(w.season), driver_name=w.driver_name, team_name=w.team_name)
                          for w in winners.head(5).itertuples()],
            story=schema.CircuitStory(designer=story.get("designer"),  # only what was history before this season
                                      moments=sorted((m for m in story.get("moments", []) if m["season"] < ctx.season),
                                                     key=lambda m: m["season"]))
            if story else None,
            speed_trap=_speed_trap(ctx, row["circuitId"])),
        sessions=[schema.Session(id=s["session_id"], name=s["session_name"], start_utc=utc(s["session_dt_utc"]),
                                 status=status(s)) for s in ctx.sessions],
        teams=[schema.Team(id=t.team_id, name=t.team_name, color=color(t.team_color)) for t in teams.itertuples()],
        drivers=[schema.Driver(id=d.driver_id, code=d.code, number=int(d.number), first_name=d.first_name,
                               last_name=d.last_name, team_id=d.team_id, headshot_url=d.headshot_url)
                 for d in roster.itertuples()],
        standings=schema.Standings(
            after_round=after_round or None,
            drivers=[schema.DriverStanding(driver_id=r.driverId, position=int(r.position), points=float(r.points),
                                           wins=int(r.wins)) for r in drivers_st.itertuples()],
            teams=[schema.TeamStanding(team_id=r.constructorId, position=int(r.position), points=float(r.points),
                                       wins=int(r.wins)) for r in teams_st.itertuples()]))


def _standings(ctx: Context) -> tuple[int, pd.DataFrame, pd.DataFrame]:
    """standings after this round once the race has run and Ergast has them, else after the previous one"""
    if "R" in ctx.usable:
        drivers, teams = ref.standings(ctx.season, ctx.round)
        if len(drivers):
            return ctx.round, drivers, teams
    return ctx.round - 1, *ref.standings(ctx.season, ctx.round - 1)


def _speed_mark(rows: pd.DataFrame) -> schema.SpeedMark | None:
    if rows.empty:
        return None
    r = rows.iloc[0]
    return schema.SpeedMark(speed_kph=float(r["speed_st_kph"]), driver_code=r["driver"], season=int(r["season"]),
                            session_id=r["session_id"])


def _speed_trap(ctx: Context, circuit_id: str) -> schema.SpeedTrap:
    """this weekend's sessions so far, and every earlier race weekend here the lakehouse holds"""
    record = lh.top_speed(_earlier_here(ctx))
    return schema.SpeedTrap(weekend=_speed_mark(lh.top_speed([(ctx.season, ctx.round)], ctx.usable)),
                            record=_speed_mark(record),
                            record_since=None if record.empty else int(record.iloc[0]["first_season"]))


def race_laps(ctx: Context) -> int:
    row = ref.circuit_row(ctx.season, ctx.round)
    geometry = ref.circuit_geometry(ctx.season, ctx.round, row["circuitId"])
    return ref.race_laps(row["circuitId"], ctx.season, geometry["length_km"])


# ---------------------------------------------------------------- weather


def weather(ctx: Context) -> schema.WeatherDoc:
    row = ref.circuit_row(ctx.season, ctx.round)
    starts = [pd.Timestamp(utc(s["session_dt_utc"])) for s in ctx.sessions]
    first, race_start = starts[0] - pd.Timedelta(hours=1), starts[-1]
    hourly = ref.hourly_weather(float(row["lat"]), float(row["long"]), first.date(), race_start.date())
    hourly = hourly[(hourly["time_utc"] >= first) & (hourly["time_utc"] <= race_start + pd.Timedelta(hours=3))]
    observed = lh.session_rows(ctx.season, ctx.round, ctx.usable).set_index("session_id") if ctx.usable else pd.DataFrame()
    wet = agg.wet_tyre_share(lh.compound_laps([(ctx.season, ctx.round)], ctx.usable)) if ctx.usable else None
    wet = {} if wet is None else dict(zip(wet["session_id"], wet["wet_tyre_share"]))

    sessions = []
    for s, start in zip(ctx.sessions, starts):
        entry = {"session_id": s["session_id"], "start_utc": start.to_pydatetime()}
        if s["session_id"] in observed.index:
            o = observed.loc[s["session_id"]]
            coldest = _num(o["track_temp_min"])  # gold rows built before the dropped-sensor fix hold 0.0 here
            entry["observed"] = schema.ObservedWeather(
                air_temp_c_mean=float(o["air_temp_mean"]), track_temp_c_max=float(o["track_temp_max"]),
                track_temp_c_min=coldest if coldest and coldest > 0 else None,
                humidity_mean=float(o["humidity_mean"]) / 100, wind_speed_ms_mean=float(o["wind_speed_mean"]),
                rain_share=float(o["rain_frac"]), wet_tyre_share=_num(wet.get(s["session_id"])))
        else:
            w = hourly[(hourly["time_utc"] >= start.floor("h")) & (hourly["time_utc"] < start + FORECAST_WINDOW)]
            if len(w):
                entry["forecast"] = schema.SessionForecast(
                    air_temp_c=float(w["temperature_2m"].mean()),
                    p_rain=float(w["precipitation_probability"].mean()) / 100,
                    wind_speed_ms=float(w["wind_speed_10m"].mean()))
        sessions.append(schema.SessionWeather(**entry))

    return schema.WeatherDoc(
        meta=ctx.meta("weather"), source="open-meteo", issued_at=None, sessions=sessions,
        hourly=[schema.HourlyForecast(
            time_utc=r.time_utc.to_pydatetime(), air_temp_c=float(r.temperature_2m),
            p_rain=float(r.precipitation_probability) / 100, rain_mm=float(r.precipitation),
            wind_speed_ms=float(r.wind_speed_10m), wind_dir_deg=float(r.wind_direction_10m) % 360,
            humidity=float(r.relative_humidity_2m) / 100) for r in hourly.itertuples()],
        climatology=_climatology(ctx))


def _climatology(ctx: Context) -> schema.Climatology | None:
    """the earlier races here the lakehouse holds"""
    races = lh.race_sessions(_earlier_here(ctx))
    if races.empty:
        return None
    wet = agg.wet_tyre_share(lh.compound_laps(list(zip(races["season"], races["round"])), ["R"]))
    races = races.merge(wet.drop(columns="session_id"), on=["season", "round"], how="left")
    return schema.Climatology(**agg.climatology(races))


# ---------------------------------------------------------------- results


def _race_rows(res: pd.DataFrame) -> list[schema.RaceRow]:
    rows = []
    for r in res.sort_values("position", na_position="last").itertuples():
        classified = str(r.classified_position)
        rows.append(schema.RaceRow(
            driver_id=r.driver_id, grid=int(r.grid_position) if _num(r.grid_position) else None,
            position=int(classified) if classified.isdigit() else None, classified_as=classified,
            status=r.status, points=_num(r.points) or 0.0, laps=int(_num(r.laps) or 0)))
    return rows


def _race_pace(ctx: Context) -> list[schema.DriverPace]:
    laps = _ids(ctx, lh.race_pace(ctx.season, ctx.round)).dropna(subset=["driver_id"])
    return [schema.DriverPace(driver_id=d, lap_times_s=g["lap_time_s"].astype(float).tolist(),
                              compounds=g["compound"].tolist())
            for d, g in laps.groupby("driver_id", sort=True)]


def _strategies(stints: pd.DataFrame) -> list[schema.DriverStrategy]:
    """what each driver ran; a driver with an unknown compound or a gap in the laps is left out"""
    out = []
    for driver_id, g in stints.groupby("driver_id"):
        g = g.sort_values("stint")
        contiguous = g["start_lap"].iloc[0] == 1 and (g["start_lap"].iloc[1:].to_numpy() == g["end_lap"].iloc[:-1].to_numpy() + 1).all()
        if not contiguous or not g["compound"].isin(schema.Compound.__args__).all():
            continue
        out.append(schema.DriverStrategy(driver_id=driver_id, stints=[
            schema.Stint(compound=s.compound, start_lap=int(s.start_lap), end_lap=int(s.end_lap)) for s in g.itertuples()]))
    return out


def _practice(ctx: Context) -> list[schema.PracticeSession]:
    """each practice session run so far, the field's drivers ranked by best lap and those without a timed
    lap last; FP1 stand-ins, and at FP1 a driver new since the last race, are not in the field"""
    ran = [sid for sid in ("FP1", "FP2", "FP3") if sid in ctx.usable]
    if not ran:
        return []
    laps = _ids(ctx, lh.practice_laps(ctx.season, ctx.round, ran))
    laps = laps[laps["driver_id"].isin(entries(ctx)["driver_id"])]
    sessions = []
    for sid in ran:
        ranked = laps[laps["session_id"] == sid].sort_values(["best_lap_rank", "driver_id"], na_position="last")
        if len(ranked):
            sessions.append(schema.PracticeSession(session_id=sid, rows=[
                schema.PracticeRow(driver_id=r.driver_id, position=i, best_lap_s=_num(r.best_lap))
                for i, r in enumerate(ranked.itertuples(), 1)]))
    return sessions


def results(ctx: Context) -> schema.ResultsDoc | None:
    """actual outcomes of the sessions run so far; None before the first session with a classification"""
    parts = {}
    if practice := _practice(ctx):
        parts["practice"] = practice
    for sid, part in (("SQ", "sprint_qualifying"), ("Q", "qualifying")):
        if sid in ctx.usable:
            q = _results(ctx, sid).dropna(subset=["position"]).sort_values("position")
            parts[part] = [schema.QualiRow(driver_id=r.driver_id, position=int(r.position), q1_s=_num(r.q1_s),
                                           q2_s=_num(r.q2_s), q3_s=_num(r.q3_s)) for r in q.itertuples()]
    if "S" in ctx.usable:
        parts["sprint"] = _race_rows(_results(ctx, "S"))
    if "R" in ctx.usable:
        parts["race"] = _race_rows(_results(ctx, "R"))
        r = lh.session_rows(ctx.season, ctx.round, ["R"]).iloc[0]
        parts["race_incidents"] = schema.IncidentCounts(safety_cars=int(r["sc_n"]), vscs=int(r["vsc_n"]), red_flags=int(r["red_n"]))
        parts["race_neutralisations"] = _periods(lh.race_flags([(ctx.season, ctx.round)])).get((ctx.season, ctx.round), [])
        parts["race_strategies"] = _strategies(_ids(ctx, lh.race_stints(ctx.season, ctx.round)))
        parts["race_pace"] = _race_pace(ctx)
    return schema.ResultsDoc(meta=ctx.meta("results"), **parts) if parts else None


# ---------------------------------------------------------------- facts


def facts(ctx: Context) -> schema.FactsDoc:
    roster = entries(ctx)
    entered = set(roster["driver_id"])
    name = dict(zip(roster["driver_id"], roster["first_name"] + " " + roster["last_name"]))
    out = []

    drivers_st, _ = ref.standings(ctx.season, ctx.round - 1)
    if len(drivers_st) >= 2:
        lead, second = drivers_st.iloc[0], drivers_st.iloc[1]
        lead_name = name.get(lead["driverId"], f"{lead['givenName']} {lead['familyName']}")
        out.append(schema.Fact(
            id="championship-leader", category="driver",
            headline=f"{lead_name} leads the championship by {lead['points'] - second['points']:.0f} points",
            body=f"{lead['points']:.0f} points and {int(lead['wins'])} wins after round {ctx.round - 1}.",
            driver_ids=[d for d in (lead["driverId"], second["driverId"]) if d in entered],
            source=f"ergast {ctx.season} driver standings after round {ctx.round - 1}"))

    row = ref.circuit_row(ctx.season, ctx.round)
    winners = ref.past_winners(row["circuitId"], ctx.season)
    if len(winners):
        last, source = winners.iloc[0], f"ergast circuit {row['circuitId']} race winners"
        out.append(schema.Fact(
            id="last-winner-here", category="history",
            headline=f"{last['driver_name']} won the last race here, in {int(last['season'])}",
            body=f"{len(winners)} earlier races at {row['circuitName']} since {int(winners['season'].min())}.",
            source=source))
        out += _circuit_facts(winners, source)
    else:
        out.append(schema.Fact(id="circuit-debut", category="history",
                               headline=f"{row['circuitName']} hosts its first Formula 1 race",
                               source=f"ergast circuit {row['circuitId']}"))

    if "Q" in ctx.usable:
        q = _results(ctx, "Q").sort_values("position")
        pole = q.iloc[0]
        out.append(schema.Fact(
            id="pole-position", category="weekend",
            headline=f"{name.get(pole['driver_id'], pole['driver'])} takes pole",
            body=f"{pole['q3_s']:.3f} s in Q3." if _num(pole["q3_s"]) else None,
            driver_ids=[pole["driver_id"]] if pole["driver_id"] in entered else [],
            source=f"fastf1 {ctx.season} R{ctx.round} qualifying"))
    return schema.FactsDoc(meta=ctx.meta("facts"), facts=out)


def _circuit_facts(winners: pd.DataFrame, source: str) -> list[schema.Fact]:
    """who wins here, and how often from pole; only when there is a pattern worth a card"""
    out = []
    for col, what in (("driver_name", "driver"), ("team_name", "team")):
        wins = winners[col].value_counts()
        top = wins[wins == wins.iloc[0]]
        if wins.iloc[0] >= 2:
            names = " and ".join(top.index)
            out.append(schema.Fact(
                id=f"most-wins-{what}", category="history",
                headline=f"{names} {'has' if len(top) == 1 else 'have'} won here {wins.iloc[0]} times"
                         f"{'' if len(top) == 1 else ' each'}",
                body=f"The most of any {what} in {len(winners)} races.", source=source))
    grid = pd.to_numeric(winners["grid"], errors="coerce")
    if grid.notna().sum() >= 3:
        out.append(schema.Fact(
            id="pole-conversion", category="circuit",
            headline=f"Pole has won {int((grid == 1).sum())} of {int(grid.notna().sum())} races here",
            body=f"Winners started on average from P{grid.mean():.1f}.", source=source))
    return out


# ---------------------------------------------------------------- predictions


def _season_order(ctx: Context) -> list[str]:
    roster = entries(ctx)
    return baselines.quali_order(roster["driver_id"].tolist(), dict(zip(roster["driver_id"], roster["team_id"])),
                                 ref.results_before(ctx.season, ctx.round, "qualifying"))


def _grid(ctx: Context, session_id: str) -> dict[str, int]:
    q = _results(ctx, session_id).dropna(subset=["position", "driver_id"])
    return dict(zip(q["driver_id"], q["position"].astype(int)))


def _by_grid(order: list[str], grid: dict[str, int]) -> list[str]:
    """order by grid position; entrants missing from it keep their relative order at the back"""
    return sorted(order, key=lambda d: grid.get(d, len(order) + 1))


def _predicted_quali(ctx: Context) -> tuple[list[str], dict[str, int] | None]:
    """the expected qualifying order and the sprint qualifying grid it comes from (None before SQ):
    sprint qualifying orders the field once it has run, else the season mean"""
    order = _season_order(ctx)
    if "SQ" not in ctx.usable:
        return order, None
    grid = _grid(ctx, "SQ")
    return _by_grid(order, grid), grid


def qualifying(ctx: Context) -> schema.QualifyingDoc:
    """the released champion until sprint qualifying has run; otherwise the baseline: the
    sprint qualifying order once SQ has run, else the season mean"""
    if "SQ" not in ctx.usable and (champion := _champion(ctx, "qualifying")):
        return _scored_qualifying(ctx, *champion)
    order, grid = _predicted_quali(ctx)
    name, feature = ("quali-sprint-order", "sprint_qualifying_position") if grid else \
        ("quali-season-average", "season_mean_quali_position")
    return schema.QualifyingDoc(meta=ctx.meta("qualifying"), model=ctx.model(name, [feature]),
                                drivers=baselines.qualifying(order))


def sprint_qualifying(ctx: Context) -> schema.SprintQualifyingDoc:
    """season-mean order only: its snapshots stop before SQ, so the result never leaks in"""
    return schema.SprintQualifyingDoc(
        meta=ctx.meta("sprint_qualifying"), model=ctx.model("quali-season-average", ["season_mean_quali_position"]),
        drivers=baselines.qualifying(_season_order(ctx)))


def _champion(ctx: Context, section: str) -> tuple[registry.Bundle, pd.DataFrame] | None:
    """the released champion and its gold.features rows for this stage, or None: no bundle, a
    bundle trained on this round's own result (a replay), or no feature rows yet"""
    bundle = registry.load(section)
    if bundle is None or date.fromisoformat(bundle.meta["trained_through"]) >= ref.event(ctx.season, ctx.round)["EventDate"].date():
        return None
    rows = lh.features(ctx.season, ctx.round, ctx.stage)
    if rows.empty:
        print(f"  {section}: champion {bundle.meta['version']} has no gold.features rows at {ctx.stage}, using the baseline")
        return None
    return bundle, _on_roster(ctx, rows, entries(ctx))


def _on_roster(ctx: Context, rows: pd.DataFrame, roster: pd.DataFrame) -> pd.DataFrame:
    """one feature row per entrant of event.json, which check_round holds every prediction to.
    gold.features can disagree on a weekend in progress (a stand-in whose code it has never
    seen, the previous round's entry list before a session has run): rows of drivers not
    entered are dropped, and an entrant without a row gets one with every feature missing,
    which the model treats like a rookie's"""
    on = roster[["driver_id", "team_id"]].rename(columns={"team_id": "constructor_id"})
    aligned = on.merge(rows.drop(columns="constructor_id"), on="driver_id", how="left")
    aligned[["season", "round", "stage"]] = ctx.season, ctx.round, ctx.stage
    missing, extra = set(on["driver_id"]) - set(rows["driver_id"]), set(rows["driver_id"]) - set(on["driver_id"])
    if missing or extra:
        print(f"  gold.features vs entry list at {ctx.stage}: no rows for {sorted(missing)}, not entered {sorted(extra)}")
    return aligned


def _model_info(meta: dict) -> schema.ModelInfo:
    return schema.ModelInfo(name=meta["name"], version=meta["version"], trained_through=meta["trained_through"],
                            features=meta["features"], calibrated=meta["calibrated"],
                            backtest=[schema.Metric(**m) for m in meta["backtest"]])


def _scored_qualifying(ctx: Context, bundle: registry.Bundle, rows: pd.DataFrame) -> schema.QualifyingDoc:
    pred = bundle.model.predict(rows, rows.iloc[:0])
    drivers = [schema.DriverQualiPrediction(driver_id=r.driver_id, position_probs=list(r.probs))
               for r in pred.itertuples()]
    drivers.sort(key=lambda d: d.expected_position)
    return schema.QualifyingDoc(meta=ctx.meta("qualifying"), model=_model_info(bundle.meta), drivers=drivers)


def _scored_finishing_order(ctx: Context, bundle: registry.Bundle, rows: pd.DataFrame) -> schema.FinishingOrderDoc:
    pred = bundle.model.predict(rows, rows.iloc[:0])
    n = len(pred)
    grid = rows.set_index("driver_id")["grid_position"]
    drivers = [schema.DriverFinishPrediction(driver_id=r.driver_id, position_probs=list(r.probs[:n]), p_dnf=float(r.probs[n]),
                                             grid_position=None if pd.isna(grid.get(r.driver_id)) else int(grid[r.driver_id]))
               for r in pred.itertuples()]
    drivers.sort(key=lambda d: d.expected_position_if_classified or n + 1)
    return schema.FinishingOrderDoc(meta=ctx.meta("finishing_order"), model=_model_info(bundle.meta), drivers=drivers)


def finishing_order(ctx: Context) -> schema.FinishingOrderDoc:
    """the released champion when there is one for this stage; otherwise the baseline: by grid
    once qualifying has run (entrants missing from it go to the back), else by predicted qualifying"""
    if champion := _champion(ctx, "finishing_order"):
        return _scored_finishing_order(ctx, *champion)
    p_dnf = baselines.dnf_rate(ref.results_before(ctx.season, ctx.round, "race"))
    order, sq_grid = _predicted_quali(ctx)
    grid, feature = None, "sprint_qualifying_position" if sq_grid else "season_mean_quali_position"
    if "Q" in ctx.usable:
        grid = _grid(ctx, "Q")
        order, feature = _by_grid(order, grid), "qualifying_position"
    return schema.FinishingOrderDoc(meta=ctx.meta("finishing_order"),
                                    model=ctx.model("grid-order", [feature, "season_dnf_rate"]),
                                    drivers=baselines.finishing_order(order, p_dnf, grid))


def sprint(ctx: Context) -> schema.SprintDoc:
    """the sprint by its grid: sprint qualifying once it has run, else the predicted order"""
    order, grid = _predicted_quali(ctx)
    sprints = ref.results_before(ctx.season, ctx.round, "sprint")
    history = sprints if len(sprints) else ref.results_before(ctx.season, ctx.round, "race")
    features = ["sprint_qualifying_position" if grid else "season_mean_quali_position",
                "sprint_dnf_rate" if len(sprints) else "season_dnf_rate"]
    return schema.SprintDoc(meta=ctx.meta("sprint"), model=ctx.model("sprint-grid-order", features),
                            drivers=baselines.finishing_order(order, baselines.dnf_rate(history), grid))


def _circuit_history(ctx: Context, races: pd.DataFrame) -> list[schema.CircuitIncidentHistory]:
    """the earlier races in the lakehouse held at this round's circuit, newest first"""
    here = set(ref.rounds_at(ref.circuit_row(ctx.season, ctx.round)["circuitId"], races["season"].unique()))
    rows = races[[(s, r) in here for s, r in zip(races["season"], races["round"])]]
    periods = _periods(lh.race_flags(list(zip(rows["season"], rows["round"]))))
    return [schema.CircuitIncidentHistory(season=int(r.season), safety_cars=int(r.sc_n), vscs=int(r.vsc_n),
                                          red_flags=int(r.red_n), periods=periods.get((int(r.season), int(r.round)), []))
            for r in rows.sort_values(["season", "round"], ascending=False).itertuples()]


def race_incidents(ctx: Context) -> schema.RaceIncidentsDoc:
    races = lh.race_history(ctx.season, ctx.round)
    rates = baselines.race_incidents(races, race_laps(ctx))
    rates.pop("races_used")
    return schema.RaceIncidentsDoc(meta=ctx.meta("race_incidents"),
                                   model=ctx.model("league-incident-rates", ["lakehouse_race_history", "prior"]),
                                   circuit_history=_circuit_history(ctx, races), **rates)


def _long_run_sessions(ctx: Context) -> list[tuple[int, int, str]]:
    """this weekend's practice and sprint so far, and every earlier race here"""
    weekend = [(ctx.season, ctx.round, sid) for sid in ctx.usable if sid in ("FP1", "FP2", "FP3", "S")]
    return weekend + [(s, r, "R") for s, r in _earlier_here(ctx)]


def strategy(ctx: Context) -> schema.StrategyDoc:
    laps = race_laps(ctx)
    measured = agg.pit_loss(lh.pit_laps(_earlier_here(ctx)))
    plan = baselines.strategy(laps)  # plans on the prior pit loss; the measured one is reported beside it
    return schema.StrategyDoc(
        meta=ctx.meta("strategy"), model=ctx.model("tyre-prior-stint-plan", ["compound_pace_prior", "degradation_prior"]),
        race_laps=laps, pit_loss_s=plan["pit_loss_s"], pit_loss_measured=measured,
        compounds_available=ref.tyre_allocation(ctx.season, ctx.round),
        options=[{k: v for k, v in o.items() if k != "time"} for o in plan["options"]],
        degradation=plan["degradation"],
        measured_degradation=agg.degradation(lh.long_run_laps(_long_run_sessions(ctx))))


class Prediction(NamedTuple):
    build: Callable[[Context], schema.Document]
    session: str  # the session it predicts; its snapshots are the stages before it
    kept_after: bool  # the last snapshot stays up once the session has run, else it goes to history


PREDICTIONS = {
    "sprint_qualifying": Prediction(sprint_qualifying, "SQ", kept_after=False),
    "sprint": Prediction(sprint, "S", kept_after=True),
    "qualifying": Prediction(qualifying, "Q", kept_after=False),
    "finishing_order": Prediction(finishing_order, "R", kept_after=True),
    "race_incidents": Prediction(race_incidents, "R", kept_after=True),
    "strategy": Prediction(strategy, "R", kept_after=True),
}
