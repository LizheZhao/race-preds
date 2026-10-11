"""
the Databricks side of the dispatcher: run the process_session bundle job for one session
and read its outcome back from ops.processed_sessions (credentials in .env)
"""
import os
from datetime import timedelta
from functools import cache

from databricks.sdk import WorkspaceClient
from databricks.sdk.errors import OperationFailed
from dotenv import load_dotenv

from src.config import ROOT
from src.publish import lakehouse as lh

JOB_NAME = "process_session"  # the bundle prefixes it, e.g. "[dev <user>] process_session"
JOB_TIMEOUT = timedelta(minutes=30)


@cache
def _client() -> WorkspaceClient:
    load_dotenv(ROOT / ".env")
    return WorkspaceClient(host=os.environ["DATABRICKS_HOST"], token=os.environ["DATABRICKS_TOKEN"])


@cache
def _job_id() -> int:
    """PROCESS_SESSION_JOB_ID if set, else the one job whose name ends in process_session"""
    if os.environ.get("PROCESS_SESSION_JOB_ID"):
        return int(os.environ["PROCESS_SESSION_JOB_ID"])
    jobs = [j for j in _client().jobs.list() if j.settings.name.endswith(JOB_NAME)]
    if len(jobs) != 1:
        raise LookupError(f"expected one {JOB_NAME} job, found {[j.settings.name for j in jobs]}; set PROCESS_SESSION_JOB_ID")
    return jobs[0].job_id


def statuses(season: int, rnd: int) -> dict[tuple[str, str], str]:
    """(session_id, stage) -> status, from the state table"""
    rows = lh.processed(season, rnd)
    return {(r.session_id, r.stage): r.status for r in rows.itertuples()}


def processed_sessions(season: int, rnd: int) -> set[str]:
    """sessions that made it all the way to gold"""
    return {sid for (sid, stage), status in statuses(season, rnd).items() if stage == "gold" and status == "succeeded"}


def run_session(season: int, rnd: int, session_id: str) -> str:
    """
    ingest -> bronze -> silver -> gold for one session and wait for it
    returns "succeeded", or "not_available" when FastF1 has no data yet; raises on any other failure
    """
    params = {"season": str(season), "round": str(rnd), "session_id": session_id}
    try:
        _client().jobs.run_now(job_id=_job_id(), job_parameters=params).result(timeout=JOB_TIMEOUT)
    except OperationFailed:
        pass  # the state table says which task failed and why
    status = statuses(season, rnd)
    if status.get((session_id, "gold")) == "succeeded":
        return "succeeded"
    if status.get((session_id, "ingest")) == "not_available":
        return "not_available"
    failed = {stage: s for (sid, stage), s in status.items() if sid == session_id and s != "succeeded"}
    raise RuntimeError(f"{season} R{rnd} {session_id} did not reach gold: {failed or 'no state recorded'}")
