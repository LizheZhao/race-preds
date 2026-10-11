"""
publish one stage of one round into the v1 site tree, the only exit to the front end

    <site>/index.json
    <site>/<season>/<round>/manifest.json, event.json, ..., <section>/<stage>.json

every section is built on its own. One that fails keeps its last good document as
`stale` (or `error` when there is none), so a broken model never blanks the page. The
round is written to a staging copy and checked with schema.check_round; only a passing
round replaces the published one
"""
import shutil
import tempfile
import traceback
from datetime import datetime
from pathlib import Path

import pandas as pd

from src import schema
from src.publish import documents as docs
from src.publish import reference as ref
from src.publish.documents import Context

# snapshot sections stop updating once their session has run: qualifying at Q, the race
# predictions at R; after that the last snapshot before it stays up
LAST_SNAPSHOT_BEFORE = {"qualifying": "Q", "finishing_order": "R", "race_incidents": "R", "strategy": "R"}
ROUND_SECTIONS = {"event": docs.event, "weather": docs.weather, "facts": docs.facts, "results": docs.results}


class PublishError(Exception):
    """the round failed schema.check_round and was not published"""


def _message(exc: Exception) -> str:
    return f"Not refreshed: {type(exc).__name__}"[:200]


def _snapshot_stages(order: list[str], section: str) -> list[str]:
    return order[:order.index(LAST_SNAPSHOT_BEFORE[section])]


def _existing(round_dir: Path, section: str, stages: list[str]) -> list[str]:
    """snapshot stages already on disk, in weekend order"""
    return [s for s in stages if (round_dir / schema.section_path(section, s)).exists()]


def _generated_at(path: Path, artifact: str) -> datetime:
    return schema.load(path, artifact).meta.generated_at


def _results_from(order: list[str]) -> str:
    """first stage whose session produces results: Q on a conventional weekend, S on a sprint one"""
    return next(s for s in order if s in ("S", "Q", "R"))


def _publish_round(ctx: Context, work: Path) -> dict[str, schema.SectionStatus]:
    """build every section into `work` (a copy of the round directory) and return the manifest entries"""
    order = schema.STAGE_ORDER[ctx.event_format]
    previous = schema.load(work / "manifest.json", "manifest").sections if (work / "manifest.json").exists() else {}
    sections: dict[str, schema.SectionStatus] = {}

    def write(rel: str, doc: schema.Document):
        path = work / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(doc.model_dump_json(indent=2) + "\n")

    def fallback(name: str, exc: Exception) -> schema.SectionStatus:
        traceback.print_exception(exc)
        last = previous.get(name)
        if last is not None and last.status in ("ready", "stale"):
            return schema.SectionStatus(status="stale", path=last.path, stage=last.stage,
                                        updated_at=last.updated_at, history=last.history, message=_message(exc))
        return schema.SectionStatus(status="error", message=_message(exc))

    for name, build in ROUND_SECTIONS.items():
        try:
            doc = build(ctx)
        except Exception as exc:
            sections[name] = fallback(name, exc)
            continue
        if doc is None:  # results before the first results session
            sections[name] = schema.SectionStatus(status="pending", available_from=_results_from(order))
            continue
        write(schema.section_path(name, ctx.stage), doc)
        sections[name] = schema.SectionStatus(status="ready", path=schema.section_path(name, ctx.stage),
                                              stage=ctx.stage, updated_at=ctx.now)

    for name, build in docs.SNAPSHOTS.items():
        stages = _snapshot_stages(order, name)
        if ctx.stage in stages:
            earlier = _existing(work, name, stages[:stages.index(ctx.stage)])
            try:
                doc = build(ctx)
            except Exception as exc:
                status = fallback(name, exc)
                sections[name] = status
                continue
            write(schema.section_path(name, ctx.stage), doc)
            sections[name] = schema.SectionStatus(status="ready", path=schema.section_path(name, ctx.stage),
                                                  stage=ctx.stage, updated_at=ctx.now, history=earlier)
            continue

        # past the section's last snapshot: the last one before the session stays up
        done = _existing(work, name, stages)
        if name == "qualifying":
            sections[name] = schema.SectionStatus(status="not_applicable", history=done,
                                                  message="Qualifying has run. The result is in the results panel.")
        elif done:
            path = work / schema.section_path(name, done[-1])
            sections[name] = schema.SectionStatus(status="ready", path=schema.section_path(name, done[-1]),
                                                  stage=done[-1], updated_at=_generated_at(path, name), history=done[:-1])
        else:
            sections[name] = schema.SectionStatus(status="error", message="No prediction was published before the session.")

    ev = ref.event(ctx.season, ctx.round)
    manifest = schema.RaceManifest(meta=ctx.meta("manifest"), event_name=ev["EventName"], format=ctx.event_format,
                                   race_start_utc=docs.utc(ev["Session5DateUtc"]), sections=sections)
    write("manifest.json", manifest)
    return sections


def _index(ctx: Context, site: Path) -> schema.SeasonIndex:
    sched, ergast = ref.schedule(ctx.season), ref.ergast_schedule(ctx.season)
    now = pd.Timestamp(ctx.now)

    def status(r) -> str:
        if int(r["RoundNumber"]) == ctx.round:
            return "current"
        return "completed" if docs.utc(r["Session5DateUtc"]) + pd.Timedelta(hours=3) < now else "upcoming"

    rounds = []
    for _, r in sched.iterrows():
        rnd = int(r["RoundNumber"])
        manifest = f"{schema.round_dir(ctx.season, rnd)}/manifest.json"
        rounds.append(schema.RoundSummary(
            round=rnd, event_name=r["EventName"], country=r["Country"],
            circuit_id=ergast.loc[rnd, "circuitId"] if rnd in ergast.index else r["Location"].lower(),
            format=r["EventFormat"], race_start_utc=docs.utc(r["Session5DateUtc"]), status=status(r),
            manifest_path=manifest if (site / manifest).exists() else None))
    return schema.SeasonIndex(meta=schema.Meta(artifact="index", season=ctx.season, generated_at=ctx.now, run_id=ctx.run_id),
                              current_round=ctx.round, rounds=rounds)


def publish(ctx: Context, site: Path) -> dict[str, schema.SectionStatus]:
    """build, check and publish one stage; raises PublishError and leaves the site untouched on a failed check"""
    site = Path(site)
    round_dir = site / schema.round_dir(ctx.season, ctx.round)
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp) / "round"
        if round_dir.exists():
            shutil.copytree(round_dir, work)
        else:
            work.mkdir()
        sections = _publish_round(ctx, work)
        problems = schema.check_round(work)
        if problems:
            raise PublishError(f"{ctx.season} R{ctx.round} {ctx.stage}:\n" + "\n".join(problems))
        if round_dir.exists():
            shutil.rmtree(round_dir)
        round_dir.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(work, round_dir)

    index = _index(ctx, site)
    (site / "index.json").write_text(index.model_dump_json(indent=2) + "\n")
    return sections
