"""
the lakehouse as seen from outside Databricks: SQL warehouse reads of gold, silver and
the state table, with the credentials in .env (DATABRICKS_HOST / TOKEN / HTTP_PATH)

every read takes the sessions usable at a stage explicitly, so publish cannot see a
session the replay clock has not reached
"""
import os
from collections.abc import Iterable
from functools import cache

import pandas as pd
from databricks import sql
from dotenv import load_dotenv

from src.config import ROOT
from src.sessions import SESSION_IDS

COMPOUNDS = "('SOFT', 'MEDIUM', 'HARD', 'INTERMEDIATE', 'WET')"


@cache
def _connection():
    load_dotenv(ROOT / ".env")
    return sql.connect(server_hostname=os.environ["DATABRICKS_HOST"].removeprefix("https://"),
                       http_path=os.environ["DATABRICKS_HTTP_PATH"],
                       access_token=os.environ["DATABRICKS_TOKEN"])


def query(statement: str, **params) -> pd.DataFrame:
    with _connection().cursor() as cur:
        cur.execute(statement, params)
        return pd.DataFrame(cur.fetchall(), columns=[c[0] for c in cur.description])


def _in(session_ids: Iterable[str]) -> str:
    """SQL IN list of session ids; only known ids get into the statement"""
    ids = list(session_ids)
    unknown = set(ids) - set(SESSION_IDS.values())
    if unknown:
        raise ValueError(f"unknown session ids {sorted(unknown)}")
    return "(" + ", ".join(f"'{i}'" for i in ids) + ")" if ids else "(NULL)"


def _rounds(rounds: Iterable[tuple[int, int]]) -> str:
    """SQL condition matching the given (season, round) pairs; FALSE for none"""
    where = " OR ".join(f"(season = {int(s)} AND round = {int(r)})" for s, r in rounds)
    return f"({where})" if where else "FALSE"


def session_rows(season: int, rnd: int, session_ids: Iterable[str]) -> pd.DataFrame:
    """gold.session rows (weather, track status counts) of the given sessions"""
    return query(f"""SELECT * FROM race_preds.gold.session
                     WHERE season = :season AND round = :rnd AND session_id IN {_in(session_ids)}""",
                 season=season, rnd=rnd)


def race_history(season: int, rnd: int) -> pd.DataFrame:
    """gold.session rows of every race before this one, any circuit"""
    return query("""SELECT * FROM race_preds.gold.session
                    WHERE session_id = 'R' AND (season < :season OR (season = :season AND round < :rnd))""",
                 season=season, rnd=rnd)


def results(season: int, rnd: int, session_id: str) -> pd.DataFrame:
    """silver.results of one session (empty if it is not in the lakehouse)"""
    return query(f"""SELECT * FROM race_preds.silver.results
                     WHERE season = :season AND round = :rnd AND session_id IN {_in([session_id])}""",
                 season=season, rnd=rnd)


def entrants(season: int, rnd: int, session_id: str) -> pd.DataFrame:
    """bronze.results of one session as FastF1 gave it, with the fields silver drops (names, team
    colour, headshot); empty if the session is not in the lakehouse"""
    return query(f"""SELECT * FROM race_preds.bronze.results
                     WHERE season = :season AND round = :rnd AND session_id IN {_in([session_id])}""",
                 season=season, rnd=rnd)


def practice_laps(season: int, rnd: int, session_ids: Iterable[str]) -> pd.DataFrame:
    """best lap and its rank per driver (session_id, driver, driver_id, best_lap, best_lap_rank) of the
    given sessions; both are null for a driver with no timed lap"""
    return query(f"""SELECT session_id, driver, driver_id, best_lap, best_lap_rank
                     FROM race_preds.gold.driver_session
                     WHERE season = :season AND round = :rnd AND session_id IN {_in(session_ids)}""",
                 season=season, rnd=rnd)


def race_stints(season: int, rnd: int) -> pd.DataFrame:
    """first and last lap of every stint each driver ran in the race"""
    return query("""SELECT driver, driver_id, stint, first(compound) AS compound,
                           min(lap_number) AS start_lap, max(lap_number) AS end_lap
                    FROM race_preds.silver.laps
                    WHERE season = :season AND round = :rnd AND session_id = 'R' AND stint IS NOT NULL
                    GROUP BY driver, driver_id, stint ORDER BY driver, stint""",
                 season=season, rnd=rnd)


def race_pace(season: int, rnd: int) -> pd.DataFrame:
    """clean green-flag race laps with a known compound (driver, driver_id, lap_number, lap_time_s,
    compound) in lap order"""
    return query(f"""SELECT driver, driver_id, lap_number, lap_time_s, compound FROM race_preds.silver.laps
                     WHERE season = :season AND round = :rnd AND session_id = 'R'
                       AND is_clean AND NOT is_deleted AND track_status = '1' AND lap_time_s IS NOT NULL
                       AND compound IN {COMPOUNDS}
                     ORDER BY driver, lap_number""",
                 season=season, rnd=rnd)


def top_speed(rounds: Iterable[tuple[int, int]], session_ids: Iterable[str] | None = None) -> pd.DataFrame:
    """the fastest speed-trap lap (driver, season, session_id, speed_st_kph) over the given rounds and sessions,
    with first_season, the earliest season those rounds have laps for"""
    rounds = list(rounds)
    if not rounds:
        return pd.DataFrame(columns=["driver", "season", "session_id", "speed_st_kph", "first_season"])
    sessions = f"AND session_id IN {_in(session_ids)}" if session_ids is not None else ""
    return query(f"""SELECT driver, season, session_id, speed_st_kph, MIN(season) OVER () AS first_season
                     FROM race_preds.silver.laps
                     WHERE {_rounds(rounds)} {sessions} AND speed_st_kph IS NOT NULL
                     ORDER BY speed_st_kph DESC LIMIT 1""")


def features(season: int, rnd: int, stage: str) -> pd.DataFrame:
    """gold.features rows of one round at one stage: what a champion model scores"""
    return query("""SELECT * FROM race_preds.gold.features
                    WHERE season = :season AND round = :rnd AND stage = :stage""",
                 season=season, rnd=rnd, stage=stage)


def processed(season: int, rnd: int) -> pd.DataFrame:
    """ops.processed_sessions rows of one round (empty before the first job ever ran)"""
    return query("""SELECT * FROM race_preds.ops.processed_sessions
                    WHERE season = :season AND round = :rnd""", season=season, rnd=rnd)


def race_flags(rounds: Iterable[tuple[int, int]]) -> pd.DataFrame:
    """one row per race lap (season, round, lap_number, sc, vsc, red): the leader's lap flags, or
    any driver's where silver has no P1 row for the lap"""
    flag = lambda col: (f"COALESCE(MAX(CASE WHEN position = 1 THEN CAST({col} AS INT) END), "
                        f"MAX(CAST({col} AS INT))) > 0")
    return query(f"""SELECT season, round, lap_number,
                            {flag("has_sc")} AS sc, {flag("has_vsc")} AS vsc, {flag("has_red")} AS red
                     FROM race_preds.silver.laps
                     WHERE session_id = 'R' AND {_rounds(rounds)} AND lap_number IS NOT NULL
                     GROUP BY season, round, lap_number""")


def long_run_laps(sessions: Iterable[tuple[int, int, str]]) -> pd.DataFrame:
    """clean timed laps of the given (season, round, session_id) sessions, the input of
    aggregates.degradation"""
    where = " OR ".join(f"(season = {int(s)} AND round = {int(r)} AND session_id IN {_in([sid])})"
                        for s, r, sid in sessions)
    return query(f"""SELECT season, round, session_id, driver, stint, stint_lap, compound, tyre_life,
                            lap_time_s, lap_time_fuel_corr_s
                     FROM race_preds.silver.laps
                     WHERE ({where or "FALSE"}) AND is_clean AND NOT is_deleted AND NOT is_generated
                       AND lap_time_s IS NOT NULL""")


def pit_laps(rounds: Iterable[tuple[int, int]]) -> pd.DataFrame:
    """every race lap of the given rounds with what aggregates.pit_stops needs"""
    return query(f"""SELECT season, round, driver, lap_number, lap_time_s, track_status,
                            is_in_lap, is_out_lap, is_clean, is_deleted
                     FROM race_preds.silver.laps
                     WHERE session_id = 'R' AND {_rounds(rounds)} AND lap_number IS NOT NULL""")


def compound_laps(rounds: Iterable[tuple[int, int]], session_ids: Iterable[str]) -> pd.DataFrame:
    """timed laps per (season, round, session_id, compound) of the given sessions of the given rounds"""
    return query(f"""SELECT season, round, session_id, compound, COUNT(*) AS laps
                     FROM race_preds.silver.laps
                     WHERE {_rounds(rounds)} AND session_id IN {_in(session_ids)} AND lap_time_s IS NOT NULL
                     GROUP BY season, round, session_id, compound""")


def race_sessions(rounds: Iterable[tuple[int, int]]) -> pd.DataFrame:
    """gold.session rows of the races of the given rounds"""
    return query(f"""SELECT * FROM race_preds.gold.session WHERE session_id = 'R' AND {_rounds(rounds)}""")
