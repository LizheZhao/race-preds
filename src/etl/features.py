"""
race_preds.gold.features: one row per season x round x stage x driver, the model input
(docs/pipeline-plan.md, Phase 3 plan step 2). Stages are pre_weekend and every session
before the race; the race result is a label, never a feature

inputs come in two kinds:

    known in advance   sessions (the schedule), entries (who drives for whom), grid (the
                       starting grid, published before the race)
    observed           driver_session (gold), results (silver)

a row at stage X of a round may read observed data only from that round's sessions up to
and including X, and from earlier rounds. leakage_check() rebuilds sampled rows from
exactly that data and compares them with the stored ones. Spark only
"""
from pyspark.sql import DataFrame, SparkSession, Window
from pyspark.sql import functions as F

TABLE = "race_preds.gold.features"
KEYS = ["season", "round", "stage", "driver_id"]

PACE_SESSIONS = ["FP1", "FP2", "FP3", "SQ", "S", "Q"]
PACE_COLS = ["best_lap_gap_pct", "team_gap_pct", "best_lap_rank", "laps_driven"]
FORM_RACES = 5
RELIABILITY_RACES = 10
FIRST_ERA_SEASON = 2026  # new technical regulations
ENTRY_SESSIONS = ["R", "Q"]  # the entry list is the race's starters, else qualifying's


def inputs(spark: SparkSession) -> dict[str, DataFrame]:
    sessions = spark.table("race_preds.bronze.sessions").select(
        F.col("season").cast("int"), F.col("round").cast("int"), "session_id", "event_format", "date")
    results = spark.table("race_preds.silver.results").select(
        F.col("season").cast("int"), F.col("round").cast("int"), "session_id", "driver_id", "constructor_id",
        "position", "classified_position", "grid_position")
    driver_session = spark.table("race_preds.gold.driver_session").select(
        F.col("season").cast("int"), F.col("round").cast("int"), "session_id", "driver_id", *PACE_COLS)
    grid = results.where(F.col("session_id") == "R").select("season", "round", "driver_id", "grid_position")
    return {"sessions": sessions, "entries": entries(results), "grid": grid, "results": results,
            "driver_session": driver_session}


def entries(results: DataFrame) -> DataFrame:
    """season, round, driver_id, constructor_id: known before the weekend in reality (the
    entry list); taken from the race starters when the race ran, else qualifying's, so FP1
    stand-ins don't count as entrants"""
    pref = F.array_position(F.array(*map(F.lit, ENTRY_SESSIONS)), F.col("session_id"))
    picked = (results.where(F.col("session_id").isin(ENTRY_SESSIONS) & F.col("driver_id").isNotNull())
              .withColumn("pref", pref)
              .withColumn("best", F.min("pref").over(Window.partitionBy("season", "round"))))
    return picked.where(F.col("pref") == F.col("best")).select("season", "round", "driver_id", "constructor_id").distinct()


def build(src: dict[str, DataFrame]) -> DataFrame:
    order = (src["sessions"]
             .withColumn("idx", F.row_number().over(Window.partitionBy("season", "round").orderBy("date"))))
    race_idx = order.where(F.col("session_id") == "R").select("season", "round", F.col("idx").alias("race_idx"))
    q_idx = order.where(F.col("session_id") == "Q").select("season", "round", F.col("idx").alias("q_idx"))
    stages = (order.where(F.col("session_id") != "R").select("season", "round", F.col("session_id").alias("stage"), F.col("idx").alias("stage_idx"))
              .unionByName(order.select("season", "round").distinct()
                           .select("season", "round", F.lit("pre_weekend").alias("stage"), F.lit(0).alias("stage_idx"))))
    context = (order.groupBy("season", "round").agg(
        F.first("event_format").alias("event_format"),
        F.sum(F.col("session_id").startswith("FP").cast("int")).alias("practice_sessions"))
        .join(race_idx, ["season", "round"], "left").join(q_idx, ["season", "round"], "left"))

    rows = (stages.join(context, ["season", "round"]).join(src["entries"], ["season", "round"])
            .withColumn("era_2026", F.col("season") >= FIRST_ERA_SEASON))

    return (rows.join(_pace(src, order, stages), KEYS, "left")
            .join(_form(src), ["season", "round", "driver_id"], "left")
            .join(_team_form(src), ["season", "round", "constructor_id"], "left")
            .transform(lambda df: _grid_and_quali(df, src))
            .join(_labels(src), ["season", "round", "driver_id"], "left")
            .drop("q_idx", "race_idx"))


def _pace(src, order, stages) -> DataFrame:
    """each session's pace columns, null unless the session is allowed at the stage"""
    seen = (stages.join(src["driver_session"].join(order.select("season", "round", "session_id", "idx"),
                                                   ["season", "round", "session_id"]), ["season", "round"])
            .where(F.col("idx") <= F.col("stage_idx")))
    wide = (seen.groupBy(*KEYS).pivot("session_id", PACE_SESSIONS)
            .agg(*[F.first(c).alias(c) for c in PACE_COLS]))
    wide = wide.select(*KEYS, *[F.col(f"{s}_{c}").alias(f"{s.lower()}_{c}") for s in PACE_SESSIONS for c in PACE_COLS])
    practice = (seen.where(F.col("session_id").startswith("FP")).groupBy(*KEYS)
                .agg(F.avg("best_lap_gap_pct").alias("practice_gap_pct"), F.avg("team_gap_pct").alias("practice_team_gap_pct")))
    return wide.join(practice, KEYS, "left")


def _race_outcomes(src) -> DataFrame:
    """per entrant and round: race finish (classified only), DNF, qualifying position"""
    r = src["results"]
    race = r.where(F.col("session_id") == "R").select(
        "season", "round", "driver_id",
        F.when(F.col("classified_position").rlike("^[0-9]+$"), F.col("position")).alias("finish"),
        (~F.col("classified_position").rlike("^[0-9]+$")).cast("int").alias("dnf"))
    quali = r.where(F.col("session_id") == "Q").select("season", "round", "driver_id", F.col("position").alias("quali"))
    return (src["entries"].join(race, ["season", "round", "driver_id"], "left")
            .join(quali, ["season", "round", "driver_id"], "left")
            .withColumn("rk", F.col("season") * 100 + F.col("round")))


def _form(src) -> DataFrame:
    """driver form from earlier rounds only: the current round is outside every window"""
    o = _race_outcomes(src)
    last = lambda n: Window.partitionBy("driver_id").orderBy("rk").rowsBetween(-n, -1)
    season = Window.partitionBy("driver_id", "season").orderBy("rk").rowsBetween(Window.unboundedPreceding, -1)
    prev = (o.groupBy("driver_id", "season").agg(F.avg("finish").alias("form_finish_prev_season"))
            .withColumn("season", F.col("season") + 1))
    return (o.select("season", "round", "driver_id",
                     F.avg("finish").over(last(FORM_RACES)).alias("form_finish"),
                     F.avg("quali").over(last(FORM_RACES)).alias("form_quali"),
                     F.avg("finish").over(season).alias("form_finish_season"),
                     F.count("rk").over(season).alias("races_this_season"),
                     F.avg("dnf").over(last(RELIABILITY_RACES)).alias("dnf_rate"))
            .join(prev, ["driver_id", "season"], "left"))


def _team_form(src) -> DataFrame:
    o = (_race_outcomes(src).groupBy("season", "round", "rk", "constructor_id")
         .agg(F.avg("finish").alias("finish"), F.avg("dnf").alias("dnf")))
    last = lambda n: Window.partitionBy("constructor_id").orderBy("rk").rowsBetween(-n, -1)
    return o.select("season", "round", "constructor_id",
                    F.avg("finish").over(last(FORM_RACES)).alias("team_form_finish"),
                    F.avg("dnf").over(last(RELIABILITY_RACES)).alias("team_dnf_rate"))


def _grid_and_quali(rows: DataFrame, src) -> DataFrame:
    """qualifying position once Q has run; the race grid only at the last stage before the
    race, when it is set (on 2021-22 sprint weekends the sprint sets it, not Q)"""
    quali = src["results"].where(F.col("session_id") == "Q").select("season", "round", "driver_id", F.col("position").alias("_q"))
    grid = src["grid"].withColumnRenamed("grid_position", "_grid")
    return (rows.join(quali, ["season", "round", "driver_id"], "left").join(grid, ["season", "round", "driver_id"], "left")
            .withColumn("quali_position", F.when(F.col("stage_idx") >= F.col("q_idx"), F.col("_q")))
            .withColumn("grid_position", F.when(F.col("stage_idx") == F.col("race_idx") - 1, F.col("_grid")))
            .drop("_q", "_grid"))


def _labels(src) -> DataFrame:
    o = _race_outcomes(src)
    return o.select("season", "round", "driver_id",
                    F.col("finish").alias("y_finish"), (F.col("dnf") == 0).alias("y_classified"),
                    F.col("quali").alias("y_quali"))


def load(spark: SparkSession) -> int:
    """rebuild the whole table; it is small (driver x stage x round since 2018)"""
    df = build(inputs(spark))
    df.write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(TABLE)
    return spark.table(TABLE).count()


def restrict(src: dict[str, DataFrame], season: int, rnd: int, stage: str) -> dict[str, DataFrame]:
    """the inputs as they stood at one stage: the known-in-advance inputs whole, observed
    data only from earlier rounds and from this round's sessions up to the stage"""
    sched = src["sessions"].where((F.col("season") == season) & (F.col("round") == rnd))
    stage_date = (sched.where(F.col("session_id") == stage).select("date").first() if stage != "pre_weekend" else None)
    allowed = ([] if stage_date is None else
               [r.session_id for r in sched.where(F.col("date") <= stage_date[0]).select("session_id").collect()])
    rk = F.col("season") * 100 + F.col("round")
    keep = (rk < season * 100 + rnd) | ((rk == season * 100 + rnd) & F.col("session_id").isin(allowed))
    return {**src, "results": src["results"].where(keep), "driver_session": src["driver_session"].where(keep)}


def leakage_check(spark: SparkSession, samples: int = 12, seed: int = 7) -> list[str]:
    """rebuild sampled (season, round, stage) rows from restricted inputs; returns mismatches"""
    src = inputs(spark)
    stored = spark.table(TABLE)
    features = [c for c in stored.columns if not c.startswith("y_")]
    keys = stored.select("season", "round", "stage").distinct().orderBy(F.rand(seed)).limit(samples).collect()
    rounded = lambda df: df.select(*[F.round(c, 9).alias(c) if t == "double" else F.col(c) for c, t in df.select(*features).dtypes])
    problems = []
    for k in keys:
        rebuilt = build(restrict(src, k.season, k.round, k.stage)).where(
            (F.col("season") == k.season) & (F.col("round") == k.round) & (F.col("stage") == k.stage))
        want = stored.where((F.col("season") == k.season) & (F.col("round") == k.round) & (F.col("stage") == k.stage))
        a, b = rounded(want), rounded(rebuilt)
        diff = a.exceptAll(b).count() + b.exceptAll(a).count()
        if diff:
            problems.append(f"{k.season} R{k.round} {k.stage}: {diff} rows differ")
    return problems
