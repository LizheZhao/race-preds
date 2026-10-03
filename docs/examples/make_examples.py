"""Regenerate docs/examples/v1 -- a synthetic but internally consistent example round for front-end development.

Italian GP 2025 (R16, Monza, conventional), snapshot taken after FP2 on Friday.
All probabilities, forecasts and history are SYNTHETIC -- this is fixture data.
"""
import json
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from src import schema as S  # noqa: E402

OUT = ROOT / "docs" / "examples" / "v1"
SEASON, ROUND, STAGE = 2025, 16, "FP2"
RUN_ID = "example-fixture"
UTC = timezone.utc
GENERATED = datetime(2025, 9, 5, 17, 10, tzinfo=UTC)
rng = np.random.default_rng(16)


def meta(artifact, stage=STAGE, rnd=ROUND):
    return S.Meta(artifact=artifact, season=SEASON, round=rnd, stage=stage,
                  generated_at=GENERATED, run_id=RUN_ID)


def write(rel, doc):
    path = OUT / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(doc.model_dump_json(indent=2) + "\n")


# ---------------------------------------------------------------- entities (2025 grid)
TEAMS = [
    ("mclaren", "McLaren", "#FF8000"), ("ferrari", "Ferrari", "#E80020"),
    ("red_bull", "Red Bull", "#3671C6"), ("mercedes", "Mercedes", "#27F4D2"),
    ("aston_martin", "Aston Martin", "#229971"), ("alpine", "Alpine", "#0093CC"),
    ("williams", "Williams", "#64C4FF"), ("rb", "Racing Bulls", "#6692FF"),
    ("haas", "Haas", "#B6BABD"), ("sauber", "Kick Sauber", "#52E252"),
]
DRIVERS = [  # id, code, number, first, last, team, relative strength (synthetic)
    ("norris", "NOR", 4, "Lando", "Norris", "mclaren", 3.0),
    ("piastri", "PIA", 81, "Oscar", "Piastri", "mclaren", 2.9),
    ("max_verstappen", "VER", 1, "Max", "Verstappen", "red_bull", 2.8),
    ("leclerc", "LEC", 16, "Charles", "Leclerc", "ferrari", 2.4),
    ("hamilton", "HAM", 44, "Lewis", "Hamilton", "ferrari", 2.1),
    ("russell", "RUS", 63, "George", "Russell", "mercedes", 2.2),
    ("antonelli", "ANT", 12, "Andrea Kimi", "Antonelli", "mercedes", 1.7),
    ("albon", "ALB", 23, "Alexander", "Albon", "williams", 1.3),
    ("sainz", "SAI", 55, "Carlos", "Sainz", "williams", 1.2),
    ("tsunoda", "TSU", 22, "Yuki", "Tsunoda", "red_bull", 1.1),
    ("hadjar", "HAD", 6, "Isack", "Hadjar", "rb", 1.1),
    ("lawson", "LAW", 30, "Liam", "Lawson", "rb", 0.9),
    ("alonso", "ALO", 14, "Fernando", "Alonso", "aston_martin", 1.0),
    ("stroll", "STR", 18, "Lance", "Stroll", "aston_martin", 0.7),
    ("hulkenberg", "HUL", 27, "Nico", "Hulkenberg", "sauber", 0.8),
    ("bortoleto", "BOR", 5, "Gabriel", "Bortoleto", "sauber", 0.7),
    ("ocon", "OCO", 31, "Esteban", "Ocon", "haas", 0.7),
    ("bearman", "BEA", 87, "Oliver", "Bearman", "haas", 0.8),
    ("gasly", "GAS", 10, "Pierre", "Gasly", "alpine", 0.6),
    ("colapinto", "COL", 43, "Franco", "Colapinto", "alpine", 0.4),
]
ids = [d[0] for d in DRIVERS]
strength = np.array([d[6] for d in DRIVERS])
n = len(DRIVERS)

# ---------------------------------------------------------------- session times (UTC)
SESSIONS = [
    ("FP1", "Practice 1", datetime(2025, 9, 5, 11, 30, tzinfo=UTC), "completed"),
    ("FP2", "Practice 2", datetime(2025, 9, 5, 15, 0, tzinfo=UTC), "completed"),
    ("FP3", "Practice 3", datetime(2025, 9, 6, 10, 30, tzinfo=UTC), "upcoming"),
    ("Q", "Qualifying", datetime(2025, 9, 6, 14, 0, tzinfo=UTC), "upcoming"),
    ("R", "Race", datetime(2025, 9, 7, 13, 0, tzinfo=UTC), "upcoming"),
]
RACE_START = SESSIONS[-1][2]
RACE_LAPS = 53

# ---------------------------------------------------------------- track outline (synthetic loop)
t = np.linspace(0, 2 * np.pi, 120, endpoint=False)
x = np.cos(t) + 0.25 * np.cos(3 * t)
y = 0.55 * np.sin(t) + 0.1 * np.sin(2 * t)
x, y = x - x.min(), y - y.min()
scale = max(x.max(), y.max())
x, y = x / scale, y / scale
outline = [(round(float(a), 4), round(float(b), 4)) for a, b in zip(x, y)]
corner_idx = np.linspace(4, 115, 11).astype(int)
corners = [S.Corner(number=i + 1, x=outline[k][0], y=outline[k][1]) for i, k in enumerate(corner_idx)]

event = S.EventDoc(
    meta=meta("event"),
    name="Italian Grand Prix",
    official_name="FORMULA 1 PIRELLI GRAN PREMIO D'ITALIA 2025",
    format="conventional",
    circuit=S.Circuit(
        id="monza", name="Autodromo Nazionale di Monza", locality="Monza", country="Italy",
        lat=45.6156, lon=9.28111, length_km=5.793, race_laps=RACE_LAPS,
        outline=outline, corners=corners,
        past_winners=[
            S.PastWinner(season=2024, driver_name="Charles Leclerc", team_name="Ferrari"),
            S.PastWinner(season=2023, driver_name="Max Verstappen", team_name="Red Bull"),
            S.PastWinner(season=2022, driver_name="Max Verstappen", team_name="Red Bull"),
        ],
    ),
    sessions=[S.Session(id=i, name=nm, start_utc=st, status=stt) for i, nm, st, stt in SESSIONS],
    teams=[S.Team(id=i, name=nm, color=c) for i, nm, c in TEAMS],
    drivers=[S.Driver(id=i, code=c, number=num, first_name=f, last_name=l, team_id=tm)
             for i, c, num, f, l, tm, _ in DRIVERS],
    standings=S.Standings(
        after_round=15,
        drivers=[S.DriverStanding(driver_id=d, position=k + 1,
                                  points=float(max(0, 320 - 22 * k)), wins=max(0, 6 - k))
                 for k, d in enumerate(ids)],
        teams=[S.TeamStanding(team_id=tm[0], position=k + 1, points=float(max(0, 560 - 60 * k)),
                              wins=max(0, 9 - 3 * k))
               for k, tm in enumerate(TEAMS)],
    ),
)
write("2025/16/event.json", event)

# ---------------------------------------------------------------- weather
hourly = []
for h in range(0, 72):
    ts = datetime(2025, 9, 5, 6, tzinfo=UTC) + timedelta(hours=h)
    local_hour = (ts.hour + 2) % 24
    temp = 19 + 8 * np.sin((local_hour - 9) / 24 * 2 * np.pi)
    p_rain = float(np.clip(0.05 + 0.25 * (h > 50) * np.exp(-((h - 58) / 5) ** 2), 0, 1))
    hourly.append(S.HourlyForecast(
        time_utc=ts, air_temp_c=round(float(temp), 1), p_rain=round(p_rain, 3),
        rain_mm=round(max(0.0, (p_rain - 0.15) * 3), 2), wind_speed_ms=round(float(2 + rng.random() * 2), 1),
        wind_dir_deg=float(round(200 + 30 * rng.random())), humidity=round(float(0.55 + 0.2 * rng.random()), 2),
    ))


def forecast_at(when):
    hf = min(hourly, key=lambda f: abs((f.time_utc - when).total_seconds()))
    return S.SessionForecast(air_temp_c=hf.air_temp_c, p_rain=hf.p_rain, wind_speed_ms=hf.wind_speed_ms)


session_weather = []
for sid, _, start, status in SESSIONS:
    observed = None
    if status == "completed":
        observed = S.ObservedWeather(air_temp_c_mean=26.4 if sid == "FP2" else 23.1,
                                     track_temp_c_max=44.0 if sid == "FP2" else 36.5,
                                     humidity_mean=0.52, wind_speed_ms_mean=1.8, rain_share=0.0)
    session_weather.append(S.SessionWeather(session_id=sid, start_utc=start,
                                            forecast=forecast_at(start), observed=observed))

weather = S.WeatherDoc(
    meta=meta("weather"), source="open-meteo", issued_at=GENERATED - timedelta(minutes=40),
    sessions=session_weather, hourly=hourly,
    climatology=S.Climatology(seasons=list(range(2018, 2025)), wet_race_share=0.14,
                              air_temp_c_mean=24.8, track_temp_c_mean=37.9),
)
write("2025/16/weather.json", weather)

# ---------------------------------------------------------------- model info
backtest = [S.Metric(name="brier_win", value=0.038, lower_is_better=True, baseline_name="championship_order",
                     baseline_value=0.045, evaluated_on="2024 season, 24 races, predictions at stage FP2")]


def model_info(name, calibrated=True):
    return S.ModelInfo(name=name, version="0.1.0", trained_through=date(2025, 8, 31),
                       features=["practice_long_run_pace", "team_form_5", "driver_form_5", "circuit_type"],
                       calibrated=calibrated, backtest=backtest if name == "finishing_order_mc" else [])


# ---------------------------------------------------------------- Monte Carlo (Plackett-Luce)
def simulate(strength, sims=20000, dnf_rate=None):
    counts = np.zeros((n, n))
    dnf_counts = np.zeros(n)
    w = np.exp(strength)
    for _ in range(sims):
        g = rng.gumbel(size=n)
        order = np.argsort(-(np.log(w) + g))
        finishers = order
        if dnf_rate is not None:
            out = rng.random(n) < dnf_rate
            dnf_counts += out
            finishers = [d for d in order if not out[d]]
        for pos, d in enumerate(finishers):
            counts[d, pos] += 1
    return counts / sims, dnf_counts / sims


def round_probs(row, rest=0.0, digits=5):
    """Round while keeping row sum exact (fixture files stay readable and valid)."""
    r = np.round(row, digits)
    r[np.argmax(r)] += round(1 - rest - r.sum(), digits)
    return [float(max(0.0, v)) for v in r]


race_probs, dnf = simulate(strength, dnf_rate=np.full(n, 0.06))
order = np.argsort(-(race_probs * np.arange(n, 0, -1)).sum(axis=1))
finishing = S.FinishingOrderDoc(
    meta=meta("finishing_order"), model=model_info("finishing_order_mc"),
    drivers=[S.DriverFinishPrediction(driver_id=ids[d], position_probs=round_probs(race_probs[d], rest=round(float(dnf[d]), 5)),
                                      p_dnf=round(float(dnf[d]), 5)) for d in order],
)

# Rounding can push a column fractionally over 1; renormalise columns only if needed.
write("2025/16/finishing_order/FP2.json", finishing)

# Earlier snapshot (FP1) -- slightly different strengths, so the front end has movers to show.
race_probs_fp1, dnf_fp1 = simulate(strength + rng.normal(0, 0.25, n), dnf_rate=np.full(n, 0.06))
order_fp1 = np.argsort(-(race_probs_fp1 * np.arange(n, 0, -1)).sum(axis=1))
write("2025/16/finishing_order/FP1.json", S.FinishingOrderDoc(
    meta=meta("finishing_order", stage="FP1"), model=model_info("finishing_order_mc"),
    drivers=[S.DriverFinishPrediction(driver_id=ids[d], position_probs=round_probs(race_probs_fp1[d], rest=round(float(dnf_fp1[d]), 5)),
                                      p_dnf=round(float(dnf_fp1[d]), 5)) for d in order_fp1],
))

# ---------------------------------------------------------------- qualifying
quali_probs, _ = simulate(strength * 1.3)
q_order = np.argsort(-(quali_probs * np.arange(n, 0, -1)).sum(axis=1))
# Sinkhorn so both rows and columns sum to 1 exactly after rounding noise.
Q = quali_probs.copy()
for _ in range(200):
    Q /= Q.sum(axis=1, keepdims=True)
    Q /= Q.sum(axis=0, keepdims=True)
qualifying = S.QualifyingDoc(
    meta=meta("qualifying"), model=model_info("qualifying_mc"),
    drivers=[S.DriverQualiPrediction(driver_id=ids[d], position_probs=[float(v) for v in Q[d]]) for d in q_order],
)
write("2025/16/qualifying/FP2.json", qualifying)

# ---------------------------------------------------------------- race incidents
windows = [(1, 1, 0.14), (2, 10, 0.12), (11, 30, 0.14), (31, 45, 0.10), (46, 53, 0.06)]
incidents = S.RaceIncidentsDoc(
    meta=meta("race_incidents"), model=model_info("race_incidents_logit", calibrated=False),
    p_safety_car=0.42, p_vsc=0.35, p_red_flag=0.06, expected_safety_cars=0.51,
    by_lap_window=[S.LapWindow(start_lap=a, end_lap=b, p_safety_car=p) for a, b, p in windows],
    circuit_history=[S.CircuitIncidentHistory(season=s, safety_cars=sc, vscs=v, red_flags=r)
                     for s, sc, v, r in [(2024, 0, 1, 0), (2023, 0, 0, 0), (2022, 1, 1, 0),
                                         (2021, 1, 0, 0), (2020, 1, 0, 1)]],
)
write("2025/16/race_incidents/FP2.json", incidents)

# ---------------------------------------------------------------- strategy
def stints(*spec):
    return [S.Stint(compound=c, start_lap=a, end_lap=b) for c, a, b in spec]


strategy = S.StrategyDoc(
    meta=meta("strategy"), model=model_info("strategy_sim"),
    race_laps=RACE_LAPS, pit_loss_s=23.8,
    compounds_available={"HARD": "C3", "MEDIUM": "C4", "SOFT": "C5"},
    options=[
        S.StrategyOption(id="1stop-m-h", stints=stints(("MEDIUM", 1, 22), ("HARD", 23, 53)),
                         expected_time_delta_s=0.0, p_best=0.58,
                         pit_windows=[S.PitWindow(stop=1, earliest_lap=18, latest_lap=27)]),
        S.StrategyOption(id="1stop-h-m", stints=stints(("HARD", 1, 33), ("MEDIUM", 34, 53)),
                         expected_time_delta_s=3.1, p_best=0.27,
                         pit_windows=[S.PitWindow(stop=1, earliest_lap=29, latest_lap=38)]),
        S.StrategyOption(id="2stop-s-m-h", stints=stints(("SOFT", 1, 12), ("MEDIUM", 13, 30), ("HARD", 31, 53)),
                         expected_time_delta_s=11.4, p_best=0.15,
                         pit_windows=[S.PitWindow(stop=1, earliest_lap=10, latest_lap=15),
                                      S.PitWindow(stop=2, earliest_lap=27, latest_lap=34)]),
    ],
    degradation=[
        S.DegradationCurve(compound=c, tyre_life=list(range(1, L + 1)),
                           lap_delta_s=[round(k * a + (k ** 2) * b, 3) for k in range(1, L + 1)],
                           source_sessions=["FP2"])
        for c, L, a, b in [("SOFT", 14, 0.06, 0.004), ("MEDIUM", 24, 0.04, 0.0015), ("HARD", 32, 0.03, 0.0007)]
    ],
)
write("2025/16/strategy/FP2.json", strategy)

# ---------------------------------------------------------------- facts
facts = S.FactsDoc(meta=meta("facts"), facts=[
    S.Fact(id="monza-fastest-lap-record", category="circuit",
           headline="Monza is the fastest track on the calendar",
           body="Average lap speeds above 250 km/h and roughly 80% of the lap at full throttle.",
           source="example"),
    S.Fact(id="fp2-top-speed", category="telemetry",
           headline="Top speed in FP2: 349 km/h at the Speed Trap",
           body="Synthetic fixture value.", driver_ids=["albon"], team_ids=["williams"],
           source="example"),
    S.Fact(id="ferrari-home-race", category="team", headline="Ferrari's home race",
           team_ids=["ferrari"], source="example"),
])
write("2025/16/facts.json", facts)

# ---------------------------------------------------------------- manifest + index
upd = GENERATED
manifest = S.RaceManifest(
    meta=meta("manifest"), event_name=event.name, format="conventional", race_start_utc=RACE_START,
    sections={
        "event": S.SectionStatus(status="ready", path="event.json", stage="FP2", updated_at=upd),
        "weather": S.SectionStatus(status="ready", path="weather.json", stage="FP2", updated_at=upd),
        "finishing_order": S.SectionStatus(status="ready", path="finishing_order/FP2.json", stage="FP2",
                                           updated_at=upd, history=["FP1"]),
        "qualifying": S.SectionStatus(status="ready", path="qualifying/FP2.json", stage="FP2", updated_at=upd),
        "race_incidents": S.SectionStatus(status="ready", path="race_incidents/FP2.json", stage="FP2", updated_at=upd),
        "strategy": S.SectionStatus(status="ready", path="strategy/FP2.json", stage="FP2", updated_at=upd),
        "facts": S.SectionStatus(status="stale", path="facts.json", stage="FP2", updated_at=upd - timedelta(hours=3),
                                 message="Fun facts could not be refreshed after FP2; showing the latest set."),
        "results": S.SectionStatus(status="pending", available_from="Q"),
    },
)
write("2025/16/manifest.json", manifest)

rounds = []
for rnd, name, country, circuit, day in [(15, "Dutch Grand Prix", "Netherlands", "zandvoort", 31),
                                          (16, "Italian Grand Prix", "Italy", "monza", 7),
                                          (17, "Azerbaijan Grand Prix", "Azerbaijan", "baku", 21)]:
    month = 8 if rnd == 15 else 9
    rounds.append(S.RoundSummary(
        round=rnd, event_name=name, country=country, circuit_id=circuit, format="conventional",
        race_start_utc=datetime(2025, month, day, 13 if rnd != 17 else 11, tzinfo=UTC),
        status={15: "completed", 16: "current", 17: "upcoming"}[rnd],
        manifest_path=f"2025/{rnd:02d}/manifest.json" if rnd == 16 else None,
    ))
index = S.SeasonIndex(meta=S.Meta(artifact="index", season=SEASON, generated_at=GENERATED, run_id=RUN_ID),
                      current_round=16, rounds=rounds)
write("index.json", index)

print("examples written to", OUT)
