"""
raw layer: one FastF1 session as six Parquet files plus a meta.json

    <root>/<season>/<round>/<session_id>/{laps,results,weather,track_status,session_status,race_control}.parquet
    <root>/<season>/<round>/<session_id>/meta.json

root is data/raw locally and a Volume path (/Volumes/race_preds/raw/fastf1) in a job;
no Databricks imports here, so the same code runs on a laptop, a GitHub runner or serverless
"""
import json
from dataclasses import fields
from pathlib import Path

import fastf1
import pandas as pd
from fastf1.exceptions import DataNotLoadedError

from src.sessions import SessionTables, get_sessions

TABLES = [f.name for f in fields(SessionTables) if f.type is pd.DataFrame]
META = [f.name for f in fields(SessionTables) if f.type is not pd.DataFrame]


class SessionNotAvailable(Exception):
    """the weekend has no such session, or FastF1 has no data for it yet; retry later"""


def session_dir(root: Path | str, season: int, rnd: int, session_id: str) -> Path:
    return Path(root) / str(season) / str(rnd) / session_id


def ingest_session(season: int, rnd: int, session_id: str, root: Path | str) -> Path:
    """
    load one session without telemetry and write it under root, overwriting a previous pull
    raises SessionNotAvailable when there is nothing to write yet
    """
    names = {s["session_id"]: s["session_name"] for s in get_sessions(season, rnd)}
    if session_id not in names:
        raise SessionNotAvailable(f"{season} R{rnd} has no {session_id}, only {list(names)}")

    session = fastf1.get_session(season, rnd, names[session_id])
    session.load(laps=True, telemetry=False, weather=True, messages=True)
    # FastF1 does not fail in load(); a session without data fails on first access
    try:
        tables = SessionTables.from_session(session)
    except DataNotLoadedError as exc:
        raise SessionNotAvailable(f"{season} R{rnd} {session_id}: FastF1 has no data yet") from exc

    out = session_dir(root, season, rnd, session_id)
    out.mkdir(parents=True, exist_ok=True)
    for name in TABLES:
        # Spark rejects nanosecond timestamps; durations are already float seconds
        getattr(tables, name).to_parquet(out / f"{name}.parquet", index=False,
                                         coerce_timestamps="us", allow_truncated_timestamps=True)

    # written last, so a directory without meta.json is an interrupted pull
    meta = {k: getattr(tables, k) for k in META}
    meta |= {"session_id": session_id, "date": tables.date.isoformat(),
             "fastf1_version": fastf1.__version__,
             "pulled_at": pd.Timestamp.now(tz="UTC").isoformat()}
    (out / "meta.json").write_text(json.dumps(meta, indent=2) + "\n")
    return out


def read_session(root: Path | str, season: int, rnd: int, session_id: str) -> SessionTables:
    """the tables of one ingested session, without FastF1"""
    src = session_dir(root, season, rnd, session_id)
    meta = json.loads((src / "meta.json").read_text())
    return SessionTables(
        **{k: meta[k] for k in META if k != "date"},
        date=pd.Timestamp(meta["date"]),
        **{name: pd.read_parquet(src / f"{name}.parquet") for name in TABLES},
    )
