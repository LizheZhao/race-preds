"""
silver layer: bronze rows cleaned and conformed, Spark-native (no pandas UDFs)

    race_preds.silver.laps     one row per driver lap: flags, stint position, fuel-corrected time
    race_preds.silver.results  one row per entrant

snake_case columns, durations in seconds with an _s suffix, Ergast ids as driver_id /
constructor_id. A session is replaced as a whole with replaceWhere, like bronze.

Ergast ids: FastF1 fills DriverId / TeamId only once Ergast has published the round
(after the race), and never for sprint qualifying. Silver takes them from any session of
the same round in bronze, so they are null for a weekend still in progress; `driver`
(the three-letter code) is always set
"""
from pyspark.sql import Column, DataFrame, SparkSession, Window
from pyspark.sql import functions as F

from src.laps import QUICKLAP_THRESHOLD

BRONZE = "race_preds.bronze"
SILVER = "race_preds.silver"
KEY = ["season", "round", "session_id"]

# Fuel correction from a prior, not estimated: fuel burn and tyre age both rise with the
# lap number and cannot be separated from lap times alone. Assumes the car starts with its
# race allowance and burns it linearly to zero, so only races and sprints are corrected
FUEL_S_PER_KG = 0.03
START_FUEL_KG_TO_2025 = 110.0
START_FUEL_KG_FROM_2026 = 70.0  # approximate; the 2026 rules cap fuel energy, not mass
SPRINT_SHARE = 100 / 305  # sprint about 100 km, race about 305 km


def _where(season: int, rnd: int, session_id: str) -> str:
    return f"season = {season} AND round = {rnd} AND session_id = '{session_id}'"


def _round_ids(spark: SparkSession, season: int, rnd: int) -> DataFrame:
    """driver code -> Ergast driver_id / constructor_id, from every session of the round"""
    results = spark.table(f"{BRONZE}.results").where((F.col("season") == season) & (F.col("round") == rnd))
    return (results
            .where(F.col("DriverId").isNotNull() & (F.col("DriverId") != ""))
            .groupBy(F.col("Abbreviation").alias("driver"))
            .agg(F.max("DriverId").alias("driver_id"), F.max("TeamId").alias("constructor_id")))


def _start_fuel_kg() -> Column:
    allowance = F.when(F.col("season") >= 2026, START_FUEL_KG_FROM_2026).otherwise(START_FUEL_KG_TO_2025)
    return (F.when(F.col("session_id") == "R", allowance)
             .when(F.col("session_id") == "S", allowance * SPRINT_SHARE))


def silver_laps(laps: DataFrame, ids: DataFrame) -> DataFrame:
    """bronze laps of one session -> conformed laps with flags and window features"""
    status = F.coalesce(F.col("TrackStatus"), F.lit(""))
    df = laps.select(
        *KEY,
        F.col("Driver").alias("driver"),
        F.col("DriverNumber").alias("driver_number"),
        F.col("Team").alias("team_name"),
        F.col("LapNumber").cast("int").alias("lap_number"),
        F.col("Stint").cast("int").alias("stint"),
        F.col("Compound").alias("compound"),
        F.col("TyreLife").cast("int").alias("tyre_life"),
        F.col("FreshTyre").alias("fresh_tyre"),
        F.col("Position").cast("int").alias("position"),
        F.col("LapTime").alias("lap_time_s"),
        F.col("Sector1Time").alias("sector1_s"),
        F.col("Sector2Time").alias("sector2_s"),
        F.col("Sector3Time").alias("sector3_s"),
        F.col("LapStartTime").alias("lap_start_s"),
        F.col("Time").alias("lap_end_s"),
        F.col("PitInTime").alias("pit_in_s"),
        F.col("PitOutTime").alias("pit_out_s"),
        F.col("SpeedI1").alias("speed_i1_kph"),
        F.col("SpeedI2").alias("speed_i2_kph"),
        F.col("SpeedFL").alias("speed_fl_kph"),
        F.col("SpeedST").alias("speed_st_kph"),
        F.col("TrackStatus").alias("track_status"),
        # every status active during the lap is in the string, so test with contains
        (status == "1").alias("is_green"),
        status.contains("2").alias("has_yellow"),
        status.contains("4").alias("has_sc"),
        status.contains("5").alias("has_red"),
        status.rlike("[67]").alias("has_vsc"),
        F.col("PitInTime").isNotNull().alias("is_in_lap"),
        F.col("PitOutTime").isNotNull().alias("is_out_lap"),
        F.col("Deleted").alias("is_deleted"),
        F.col("DeletedReason").alias("deleted_reason"),
        F.col("IsAccurate").alias("is_accurate"),
        F.col("FastF1Generated").alias("is_generated"),
        F.col("IsPersonalBest").alias("is_personal_best"),
        "pulled_at",
    )

    # src.laps.clean_laps: no pit in/out, green throughout, accurate timing
    df = df.withColumn("is_clean", ~F.col("is_in_lap") & ~F.col("is_out_lap")
                       & F.col("is_green") & F.col("is_accurate"))
    # src.laps.quick_laps over driven, not-deleted clean laps, the set summarize_session uses
    timed_clean = F.col("is_clean") & ~F.col("is_deleted") & ~F.col("is_generated")
    session = Window.partitionBy(*KEY)
    fastest_clean = F.min(F.when(timed_clean, F.col("lap_time_s"))).over(session)
    # a lap without a time is not quick (null in Spark, False in pandas)
    quick = timed_clean & (F.col("lap_time_s") < fastest_clean * QUICKLAP_THRESHOLD)
    df = df.withColumn("is_quick", F.coalesce(quick, F.lit(False)))

    # position inside the stint, and fuel load at the start of the lap
    stint = Window.partitionBy(*KEY, "driver", "stint").orderBy("lap_number")
    df = df.withColumn("stint_lap", F.row_number().over(stint))
    total_laps = F.max("lap_number").over(session)
    df = df.withColumn("fuel_kg", _start_fuel_kg() * (1 - (F.col("lap_number") - 1) / total_laps))
    df = df.withColumn("lap_time_fuel_corr_s", F.col("lap_time_s") - FUEL_S_PER_KG * F.col("fuel_kg"))

    df = df.join(ids, "driver", "left")
    first = [*KEY, "driver", "driver_id", "constructor_id"]
    return df.select(*first, *[c for c in df.columns if c not in first])


def silver_results(results: DataFrame, ids: DataFrame) -> DataFrame:
    """bronze results of one session -> conformed entrant rows"""
    df = results.select(
        *KEY,
        F.col("Abbreviation").alias("driver"),
        F.col("DriverNumber").alias("driver_number"),
        F.col("FullName").alias("driver_name"),
        F.col("TeamName").alias("team_name"),
        F.col("Position").cast("int").alias("position"),
        # "R" retired, "D" disqualified, "E" excluded, "W" withdrawn, "N" not classified
        F.col("ClassifiedPosition").alias("classified_position"),
        F.col("GridPosition").cast("int").alias("grid_position"),
        F.col("Status").alias("status"),
        F.col("Points").alias("points"),
        F.col("Laps").cast("int").alias("laps"),
        F.col("Q1").alias("q1_s"),
        F.col("Q2").alias("q2_s"),
        F.col("Q3").alias("q3_s"),
        # race: total time for the winner, gap to the winner for the others
        F.col("Time").alias("time_s"),
        "pulled_at",
    )
    df = df.join(ids, "driver", "left")
    first = [*KEY, "driver", "driver_id", "constructor_id"]
    return df.select(*first, *[c for c in df.columns if c not in first])


def load_session(spark: SparkSession, season: int, rnd: int, session_id: str) -> dict[str, int]:
    """rebuild one session in the silver tables from bronze; returns rows per table"""
    where = _where(season, rnd, session_id)
    ids = _round_ids(spark, season, rnd)
    built = {
        "laps": silver_laps(spark.table(f"{BRONZE}.laps").where(where), ids),
        "results": silver_results(spark.table(f"{BRONZE}.results").where(where), ids),
    }

    spark.sql(f"CREATE SCHEMA IF NOT EXISTS {SILVER}")
    counts = {}
    for name, df in built.items():
        table = f"{SILVER}.{name}"
        (df.write.format("delta").mode("overwrite")
           .option("replaceWhere", where)
           .option("mergeSchema", "true")
           .saveAsTable(table))
        counts[name] = spark.table(table).where(where).count()
    return counts
