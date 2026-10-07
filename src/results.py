from collections.abc import Callable, Iterable

import pandas as pd
import fastf1
from fastf1.ergast import Ergast
from fastf1.ergast.interface import ErgastMultiResponse

from src.sessions import get_sessions


def establish_api(limit=100):
    """jolpica caps a page at 100 rows"""
    return Ergast(limit=limit)


def collect_pages(fetch: Callable[..., ErgastMultiResponse], **filters) -> tuple[pd.DataFrame, pd.DataFrame]:
    """
    request every page of a multi-response Ergast endpoint and stack them
      results: one row per content row, tagged with season and round
      races:   one row per race (description), deduplicated

    pages are cut by row count, not by race, so one race can straddle two pages;
    its description then appears on both pages and is deduplicated here
    works for any ErgastMultiResponse endpoint (results, pit stops, standings, ...)
    """
    contents, descriptions = [], []
    page = fetch(**filters)
    while True:
        for content, (_, race) in zip(page.content, page.description.iterrows()):
            contents.append(content.assign(season=race["season"], round=race["round"]))
        descriptions.append(page.description)
        # is_complete is False on every page after the first, so page on until the end
        try:
            page = page.get_next_result_page()
        except ValueError:
            break

    if not contents:
        return pd.DataFrame(), pd.DataFrame()
    # drop all-empty columns per page before stacking so pandas infers dtypes from real values
    results = pd.concat([c.dropna(axis=1, how="all") for c in contents], ignore_index=True)
    races = pd.concat(descriptions, ignore_index=True).drop_duplicates(["season", "round"])
    assert len(results) == page.total_results, "rows lost while paging"
    return results, races.reset_index(drop=True)


def get_season_results(year: int, kind: str = "race") -> tuple[pd.DataFrame, pd.DataFrame]:
    """
    results and race info for one season
    kind: "race", "sprint", "qualifying" (see RESULT_ENDPOINTS) or "sprint_qualifying"
    """
    # Ergast result endpoints
    # Sprint qualifying is not in Ergast derive it from the FastF1 session instead
    RESULT_ENDPOINTS = {
        "race": "get_race_results",
        "sprint": "get_sprint_results",
        "qualifying": "get_qualifying_results",
    }
    if kind not in [*RESULT_ENDPOINTS, 'sprint_qualifying']:
        raise ValueError(f"unknown kind {kind!r}, expected one of {[*RESULT_ENDPOINTS, 'sprint_qualifying']}")

    if kind == "sprint_qualifying":
        return _sprint_qualifying_from_fastf1(year)
    else:
        api = establish_api()
        fetch = getattr(api, RESULT_ENDPOINTS[kind])
        results, races = collect_pages(fetch, season=year)
        return results.assign(session=kind), races


def _sprint_qualifying_from_fastf1(year: int) -> tuple[pd.DataFrame, pd.DataFrame]:
    """
    sprint qualifying results for one season, in the same shape as Ergast qualifying
    called through get_season_results(year, "sprint_qualifying")

    Ergast has no sprint qualifying, so this loads each SQ session from FastF1, which
    classifies it from lap times by SQ1/SQ2/SQ3 elimination. That needs laps and race
    control messages (for the segment split); without messages Position comes back empty.
    Ergast ids are mapped from the same round's sprint results.
    Drivers who set no time get NaN from FastF1; they are placed at the back
    (position_imputed = True) so every entrant has a position, as in Ergast.
    """
    sprint, races = get_season_results(year, "sprint")
    if sprint.empty:
        return pd.DataFrame(), races

    ids = sprint[["round", "driverCode", "driverId", "constructorId", "constructorName"]]
    rounds = []
    for rnd in sorted(sprint["round"].unique()):
        # 2021-22 sprint weekends have no SQ session
        sq_name = next((s["session_name"] for s in get_sessions(year, int(rnd))
                        if s["session_id"] == "SQ"), None)
        if sq_name is None:
            continue
        session = fastf1.get_session(year, int(rnd), sq_name)
        session.load(laps=True, telemetry=False, weather=False, messages=True)
        res = session.results.rename(columns={
            "Abbreviation": "driverCode",
            "DriverNumber": "driverNumber",
            "Position": "position",
        })[["driverCode", "driverNumber", "position", "Q1", "Q2", "Q3"]].copy()

        # no-time drivers go to the back, in the order FastF1 lists them
        res["position_imputed"] = res["position"].isna()
        n_timed = int(res["position"].notna().sum())
        res.loc[res["position_imputed"], "position"] = range(n_timed + 1, len(res) + 1)
        res["position"] = res["position"].astype(int)
        res["driverNumber"] = res["driverNumber"].astype(int)  # FastF1 uses strings, Ergast ints

        res["round"] = int(rnd)
        rounds.append(res.sort_values("position"))

    results = pd.concat(rounds, ignore_index=True)
    results = results.merge(ids, on=["round", "driverCode"], how="left")
    results["season"] = year
    return results.assign(session="sprint_qualifying"), races


def get_results(years: Iterable[int], kind: str = "race") -> tuple[pd.DataFrame, pd.DataFrame]:
    """
    get_season_results over several seasons, stacked
    FastF1 throttles to 4 calls/s and raises after 500 uncached calls/h; responses are
    cached, so an interrupted backfill can simply be rerun
    """
    all_results, all_races = [], []
    for year in years:
        results, races = get_season_results(year, kind)
        all_results.append(results)
        all_races.append(races)
    return pd.concat(all_results, ignore_index=True), pd.concat(all_races, ignore_index=True)
