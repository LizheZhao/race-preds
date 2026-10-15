"""
raw layer: one FastF1 session as six Parquet files plus a meta.json

    <root>/<season>/<round>/<session_id>/{laps,results,weather,track_status,session_status,race_control}.parquet
    <root>/<season>/<round>/<session_id>/meta.json

root is data/raw locally and a Volume path (/Volumes/race_preds/raw/fastf1) in a job;
no Databricks imports here, so the same code runs on a laptop, a GitHub runner or serverless
"""
import json
from collections import Counter
from contextlib import contextmanager
from dataclasses import fields
from pathlib import Path

import fastf1
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import requests
from fastf1.exceptions import DataNotLoadedError
from fastf1.req import Cache

from src.sessions import SessionTables, get_sessions

TABLES = [f.name for f in fields(SessionTables) if f.type is pd.DataFrame]
META = [f.name for f in fields(SessionTables) if f.type is not pd.DataFrame]

# Parquet types for columns FastF1 leaves all-None in many sessions (race control Lap,
# Status, RacingNumber, Sector...). Written as they are, they get Parquet's null type,
# which Delta cannot store and which differs from the same column in other sessions
FIXED_TYPES = {
    "race_control": {"Category": pa.string(), "Message": pa.string(), "Status": pa.string(),
                     "Flag": pa.string(), "Scope": pa.string(), "Sector": pa.float64(),
                     "RacingNumber": pa.string(), "Lap": pa.int64()},
}


class SessionNotAvailable(Exception):
    """the weekend has no such session, or FastF1 has no data for it yet; retry later"""


class ArchiveRequestFailed(Exception):
    """F1's live timing archive refused or failed a request: blocked, rate limited, down or unreachable"""


# FastF1 reads every session file from the live timing archive, then from its own mirror
# (livetiming-mirror.fastf1.dev) when the archive answers >= 400
ARCHIVE = "https://livetiming.formula1.com/static/"


@contextmanager
def _watch_requests():
    """
    every request FastF1 makes inside the block, as (url, response or exception)
    Session.load() logs and swallows failed requests, so this is the only place to see them
    """
    seen = []
    get, original = Cache.requests_get, Cache.__dict__["requests_get"]

    def watched(url, **kwargs):
        try:
            response = get(url, **kwargs)
        except requests.RequestException as exc:
            seen.append((url, exc))
            raise
        seen.append((url, response))
        return response

    Cache.requests_get = staticmethod(watched)
    try:
        yield seen
    finally:
        Cache.requests_get = original


def _archive_failures(seen: list) -> Counter:
    """
    archive requests that neither got the file nor a "no such file", and that the mirror did
    not serve either, counted by what went wrong
    a file the archive does not have yet is S3's 403 AccessDenied (S3 says 403, not 404, for
    a missing key); the 2026-10-15 block was a 401 from a CloudFront function
    """
    def missing(r):
        return r.status_code == 404 or (r.status_code == 403 and r.headers.get("Server") == "AmazonS3")

    def file(url):
        return url.partition("/static/")[2]

    served = {file(url) for url, r in seen if not isinstance(r, Exception) and r.ok}
    return Counter(
        type(r).__name__ if isinstance(r, Exception) else f"HTTP {r.status_code} ({r.headers.get('X-Cache')})"
        for url, r in seen
        if url.startswith(ARCHIVE) and file(url) not in served
        and (isinstance(r, Exception) or not (r.ok or missing(r))))


def session_dir(root: Path | str, season: int, rnd: int, session_id: str) -> Path:
    return Path(root) / str(season) / str(rnd) / session_id


def _write_parquet(df: pd.DataFrame, path: Path, fixed: dict[str, pa.DataType]) -> None:
    """one table as Parquet that Spark and Delta accept: microsecond timestamps, no null-typed columns"""
    table = pa.Table.from_pandas(df, preserve_index=False)
    schema = pa.schema([pa.field(f.name, fixed.get(f.name, f.type)) for f in table.schema],
                       metadata=table.schema.metadata)
    untyped = [f.name for f in schema if pa.types.is_null(f.type)]
    if untyped:
        raise ValueError(f"{path}: {untyped} are empty in this session and have no type in FIXED_TYPES")
    # the pandas metadata is kept, so read_session gets the original pandas dtypes back
    pq.write_table(table.cast(schema), path, coerce_timestamps="us", allow_truncated_timestamps=True)


def ingest_session(season: int, rnd: int, session_id: str, root: Path | str) -> Path:
    """
    load one session without telemetry and write it under root, overwriting a previous pull
    raises SessionNotAvailable when there is nothing to write yet, and ArchiveRequestFailed
    when F1 refused or failed a request, so a block is not mistaken for data still to come
    """
    names = {s["session_id"]: s["session_name"] for s in get_sessions(season, rnd)}
    if session_id not in names:
        raise SessionNotAvailable(f"{season} R{rnd} has no {session_id}, only {list(names)}")

    session = fastf1.get_session(season, rnd, names[session_id])
    with _watch_requests() as seen:
        session.load(laps=True, telemetry=False, weather=True, messages=True)
    if failures := _archive_failures(seen):
        raise ArchiveRequestFailed(f"{season} R{rnd} {session_id}: live timing archive failed "
                                   + ", ".join(f"{n} x {what}" for what, n in failures.items()))
    # FastF1 does not fail in load(); a session without data fails on first access
    try:
        tables = SessionTables.from_session(session)
    except DataNotLoadedError as exc:
        raise SessionNotAvailable(f"{season} R{rnd} {session_id}: FastF1 has no data yet") from exc

    out = session_dir(root, season, rnd, session_id)
    out.mkdir(parents=True, exist_ok=True)
    for name in TABLES:
        _write_parquet(getattr(tables, name), out / f"{name}.parquet", FIXED_TYPES.get(name, {}))

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
