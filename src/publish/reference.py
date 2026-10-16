"""
reference data from outside the lakehouse: FastF1 schedule and entry list, Ergast
(jolpica) circuit, standings and history, Open-Meteo weather, circuit geometry

everything is "as of" the round being published: history stops at the previous round,
so a replay of a past weekend sees what was knowable before it. Results are cached for
the life of the process (jolpica allows about 4 requests/s and 500/h)
"""
import json
import time
from datetime import date
from functools import cache
from math import ceil

import fastf1
import numpy as np
import pandas as pd
import requests
from fastf1.ergast import Ergast
from fastf1.exceptions import ErgastInvalidRequestError

from src.config import CIRCUIT_DIR, STORY_DIR, TYRE_DIR
from src.results import collect_pages

RACE_DISTANCE_KM = 305  # FIA minimum race distance; race laps = the fewest laps covering it
OUTLINE_POINTS = 150
HOURLY_VARS = ["temperature_2m", "precipitation_probability", "precipitation",
               "wind_speed_10m", "wind_direction_10m", "relative_humidity_2m"]


def _retry(fetch, *args, **kwargs):
    """call a jolpica endpoint, waiting and retrying when it answers 'Too Many Requests'"""
    for attempt in range(6):
        try:
            return fetch(*args, **kwargs)
        except ErgastInvalidRequestError:
            time.sleep(10 * (attempt + 1))
    raise RuntimeError("jolpica kept refusing the request")


@cache
def _ergast() -> Ergast:
    return Ergast(limit=100)


# ---------------------------------------------------------------- schedule and circuit


@cache
def schedule(season: int) -> pd.DataFrame:
    return fastf1.get_event_schedule(season, include_testing=False)


@cache
def ergast_schedule(season: int) -> pd.DataFrame:
    return _retry(_ergast().get_race_schedule, season=season).set_index("round")


def event(season: int, rnd: int) -> pd.Series:
    return schedule(season).set_index("RoundNumber").loc[rnd]


def circuit_row(season: int, rnd: int) -> pd.Series:
    """Ergast race row: circuitId, circuitName, locality, country, lat, long"""
    return ergast_schedule(season).loc[rnd]


@cache
def past_winners(circuit_id: str, before_season: int) -> pd.DataFrame:
    """race winners at the circuit in earlier seasons, newest first, with the laps they ran"""
    winners, _ = _retry(collect_pages, _ergast().get_race_results, circuit=circuit_id, results_position=1)
    if winners.empty:
        return pd.DataFrame(columns=["season", "driver_name", "team_name", "laps", "grid"])
    winners = winners[winners["season"] < before_season]
    return (winners.assign(driver_name=winners["givenName"] + " " + winners["familyName"],
                           team_name=winners["constructorName"])
            .sort_values("season", ascending=False)[["season", "driver_name", "team_name", "laps", "grid"]])


def rounds_at(circuit_id: str, seasons) -> list[tuple[int, int]]:
    """(season, round) of every race held at the circuit in the given seasons"""
    return [(int(s), int(r)) for s in seasons for r, row in ergast_schedule(int(s)).iterrows()
            if row["circuitId"] == circuit_id]


def circuit_story(circuit_id: str) -> dict | None:
    """the curated story of a circuit, or None when nobody has written one"""
    path = STORY_DIR / f"{circuit_id}.json"
    return json.loads(path.read_text()) if path.exists() else None


def tyre_allocation(season: int, rnd: int) -> dict[str, str] | None:
    """Pirelli's dry compounds for the round, e.g. {"SOFT": "C5"}; None when not recorded"""
    path = TYRE_DIR / f"{season}.json"
    entry = json.loads(path.read_text())["rounds"].get(str(rnd)) if path.exists() else None
    return {c: entry[c] for c in ("SOFT", "MEDIUM", "HARD")} if entry else None


def _geometry_source(season: int, rnd: int, circuit_id: str):
    """a FastF1 session at this circuit with timing data: this event first, then up to 3 seasons back"""
    candidates = [(season, rnd)]
    for year in range(season - 1, season - 4, -1):
        if year < 2018:
            break
        rounds = ergast_schedule(year)
        candidates += [(year, int(r)) for r in rounds.index[rounds["circuitId"] == circuit_id]]
    for year, r in candidates:
        for name in ("Qualifying", "Race"):
            try:
                session = fastf1.get_session(year, r, name)
                session.load(laps=True, telemetry=True, weather=False, messages=False)
                session.laps.pick_fastest().get_pos_data()
                return session
            except Exception:
                continue
    raise LookupError(f"no FastF1 session with telemetry at {circuit_id}")


def circuit_geometry(season: int, rnd: int, circuit_id: str) -> dict:
    """
    track outline and corners in the unit square (rotated to broadcast orientation, y down
    for SVG) plus the lap length. Static reference data, built once from any session at the
    circuit and cached as CIRCUIT_DIR/<circuit_id>.json
    """
    path = CIRCUIT_DIR / f"{circuit_id}.json"
    if path.exists():
        return json.loads(path.read_text())

    session = _geometry_source(season, rnd, circuit_id)
    fastest = session.laps.pick_fastest()
    pos = fastest.get_pos_data()
    length_km = float(fastest.get_car_data().add_distance()["Distance"].max() / 1000)
    try:
        info = session.get_circuit_info()
        rotation, corners = info.rotation, info.corners
    except Exception:
        rotation, corners = 0.0, pd.DataFrame(columns=["X", "Y", "Number", "Letter"])

    angle = np.deg2rad(rotation)
    rotate = lambda x, y: (x * np.cos(angle) + y * np.sin(angle), -x * np.sin(angle) + y * np.cos(angle))
    x, y = rotate(pos["X"].to_numpy(float), pos["Y"].to_numpy(float))
    x0, y1, scale = x.min(), y.max(), max(np.ptp(x), np.ptp(y))
    unit = lambda px, py: (float(np.clip((px - x0) / scale, 0, 1)), float(np.clip((y1 - py) / scale, 0, 1)))

    keep = np.linspace(0, len(x) - 1, OUTLINE_POINTS).astype(int)
    cx, cy = rotate(corners["X"].to_numpy(float), corners["Y"].to_numpy(float))
    geometry = {
        "source": f"fastf1 {session.event.year} R{session.event['RoundNumber']} {session.name}",
        "length_km": round(length_km, 3),
        "outline": [[round(v, 4) for v in unit(x[i], y[i])] for i in keep],
        "corners": [{"number": int(n), "letter": str(l or ""), **dict(zip(("x", "y"), (round(v, 4) for v in unit(a, b))))}
                    for n, l, a, b in zip(corners["Number"], corners["Letter"], cx, cy)],
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(geometry, indent=1) + "\n")
    return geometry


def race_laps(circuit_id: str, before_season: int, length_km: float) -> int:
    """
    scheduled race laps: the most common winner's lap count of the last three races at the
    circuit (a red-flagged or shortened race does not outvote the other two), otherwise the
    fewest laps covering 305 km of the measured lap, which is a little short of the official one
    """
    recent = past_winners(circuit_id, before_season).head(3)["laps"].dropna().astype(int)
    if len(recent):
        return int(recent.mode().max())
    return ceil(RACE_DISTANCE_KM / length_km)


# ---------------------------------------------------------------- entry list and standings


@cache
def _session_results(season: int, rnd: int, session_name: str) -> pd.DataFrame:
    session = fastf1.get_session(season, rnd, session_name)
    session.load(laps=False, telemetry=False, weather=False, messages=False)
    return session.results.reset_index(drop=True)


@cache
def _ergast_driver_ids(season: int) -> dict[str, str]:
    """driver code -> Ergast driverId for everyone entered in the season so far"""
    drivers = _retry(_ergast().get_driver_info, season=season)
    return dict(zip(drivers["driverCode"], drivers["driverId"]))


@cache
def entry_list(season: int, rnd: int, session_name: str | None = None) -> pd.DataFrame:
    """
    the field: the classification of `session_name` this weekend, or of the previous round's
    race when None (before a session has run, or after FP1 only, where rookies stand in).
    While a weekend is in progress FastF1 has no Ergast ids yet; they come from the previous
    round (driver code, team name) and the season's Ergast driver list. Known gap: a season
    opener has no previous round
    """
    if session_name is None and rnd == 1:
        raise LookupError("no previous round to take the season opener's entry list from")
    r = _session_results(season, rnd - 1, "Race") if session_name is None else _session_results(season, rnd, session_name)
    r = r.copy()
    if ((r["DriverId"] == "") | (r["TeamId"] == "")).any() and rnd > 1:
        prev = _session_results(season, rnd - 1, "Race")
        driver_ids = {**_ergast_driver_ids(season), **dict(zip(prev["Abbreviation"], prev["DriverId"]))}
        team_ids = dict(zip(prev["TeamName"], prev["TeamId"]))
        r["DriverId"] = r["DriverId"].where(r["DriverId"] != "", r["Abbreviation"].map(driver_ids))
        r["TeamId"] = r["TeamId"].where(r["TeamId"] != "", r["TeamName"].map(team_ids))
    missing = r.loc[r["DriverId"].fillna("").eq("") | r["TeamId"].fillna("").eq(""), "Abbreviation"].tolist()
    if missing:
        raise LookupError(f"{season} R{rnd} {session_name or 'previous race'}: no Ergast ids for {missing}")
    return pd.DataFrame({
        "driver_id": r["DriverId"], "code": r["Abbreviation"], "number": r["DriverNumber"].astype(int),
        "first_name": r["FirstName"], "last_name": r["LastName"], "team_id": r["TeamId"],
        "team_name": r["TeamName"], "team_color": r["TeamColor"],
        "headshot_url": r["HeadshotUrl"].where(r["HeadshotUrl"].fillna("") != "", None),
    })


@cache
def standings(season: int, after_round: int) -> tuple[pd.DataFrame, pd.DataFrame]:
    """driver and constructor standings after a round (empty before the opener)"""
    if after_round < 1:
        return pd.DataFrame(), pd.DataFrame()
    drivers = _retry(_ergast().get_driver_standings, season=season, round=after_round).content
    teams = _retry(_ergast().get_constructor_standings, season=season, round=after_round).content
    if not drivers or not teams:  # Ergast has not published the round yet
        return pd.DataFrame(), pd.DataFrame()
    return drivers[0], teams[0]


@cache
def season_results(season: int, kind: str) -> pd.DataFrame:
    """Ergast race, sprint or qualifying results of a whole season (all rounds published so far)"""
    fetch = {"race": _ergast().get_race_results, "qualifying": _ergast().get_qualifying_results,
             "sprint": _ergast().get_sprint_results}[kind]
    results, _ = _retry(collect_pages, fetch, season=season)
    return results


def results_before(season: int, rnd: int, kind: str) -> pd.DataFrame:
    """Ergast results of this season's rounds before rnd"""
    res = season_results(season, kind)
    return res[res["round"] < rnd] if len(res) else res


# ---------------------------------------------------------------- weather


def hourly_weather(lat: float, lon: float, start: date, end: date) -> pd.DataFrame:
    """
    Open-Meteo hourly forecast for the dates; for dates already past it uses the
    historical-forecast API, which archives what the forecast said, so a replay sees a
    forecast and not the observed weather
    """
    past = end < pd.Timestamp.now(tz="UTC").date()
    host = "historical-forecast-api.open-meteo.com" if past else "api.open-meteo.com"
    resp = requests.get(f"https://{host}/v1/forecast", timeout=30, params={
        "latitude": lat, "longitude": lon, "hourly": ",".join(HOURLY_VARS), "wind_speed_unit": "ms",
        "start_date": start.isoformat(), "end_date": end.isoformat(), "timezone": "UTC"})
    resp.raise_for_status()
    hourly = pd.DataFrame(resp.json()["hourly"])
    hourly["time_utc"] = pd.to_datetime(hourly.pop("time"), utc=True)
    return hourly.dropna()
