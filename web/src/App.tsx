import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  loadCurrentRound,
  loadLatestPrediction,
  loadStageSnapshots,
} from "@/data/api";
import type { PredictionKey, Stage } from "@/data/types";
import { PREDICTION_KEYS } from "@/data/types";
import { RaceProvider } from "@/components/race/context";
import {
  predictionColumns,
  TREND_KEYS,
  type TrendDocs,
} from "@/components/race/compare";
import { probNoun } from "@/components/race/context";
import { Header, STAGE_LABEL, STAGE_ORDER } from "@/components/race/Header";
import { SectionCard } from "@/components/race/SectionCard";
import { CircuitView } from "@/components/race/CircuitCard";
import { WeatherLegend, WeatherView } from "@/components/race/WeatherCard";
import { FinishingOrderView } from "@/components/race/FinishingOrder";
import { CompoundLegend, StrategyView } from "@/components/race/Strategy";
import { IncidentsView } from "@/components/race/Incidents";
import { RacePaceView } from "@/components/race/RacePace";
import { StoryView } from "@/components/race/Story";
import { ResultsView } from "@/components/race/Results";
import { Verdict } from "@/components/race/Verdict";

/** Page order; the manifest section decides whether each one exists. */
const SECTIONS = [
  { id: "finishing", nav: "Finishing order", key: "finishing_order" },
  { id: "strategy", nav: "Tyre strategy", key: "strategy" },
  { id: "risk", nav: "SC & red flag", key: "race_incidents" },
  { id: "stints", nav: "Race pace", key: "results" },
  { id: "weather", nav: "Weather", key: "weather" },
  { id: "story", nav: "Circuit story", key: "facts" },
  { id: "circuit", nav: "Circuit", key: "event" },
  { id: "results", nav: "Results & standings", key: "results" },
] as const;

export function App() {
  const q = useQuery({
    queryKey: ["round"],
    queryFn: loadCurrentRound,
    staleTime: 60_000,
  });
  const [picked, setPicked] = useState<Stage | null>(null);
  const bundle = q.data;
  // Every derived query is keyed on the round, so a new round never reuses old snapshots.
  const roundKey = bundle?.roundDir;
  const current: Stage = bundle?.manifest.meta.stage ?? "pre_weekend";
  const selected = picked ?? current;
  const isHistory = selected !== current;

  const snap = useQuery({
    queryKey: ["snap", roundKey, selected],
    queryFn: () => loadStageSnapshots(bundle!, selected),
    enabled: !!bundle && isHistory,
    staleTime: Infinity,
  });

  // Every stage with a prediction snapshot: each section's history and its latest stage,
  // which trails the manifest stage once predictions stop (after qualifying, after the race).
  const order = bundle ? STAGE_ORDER[bundle.manifest.format] : [];
  const selectable = useMemo(() => {
    const s = new Set<Stage>([current]);
    if (bundle)
      for (const k of PREDICTION_KEYS) {
        const sec = bundle.manifest.sections[k];
        for (const h of sec?.history ?? []) s.add(h);
        if (sec?.stage) s.add(sec.stage);
      }
    return s;
  }, [bundle, current]);

  // The trend's session columns are each prediction's newest snapshot, history included.
  const trendQ = useQuery({
    queryKey: ["trend", roundKey, bundle?.manifest.meta.generated_at],
    queryFn: async () => {
      const [sprint_qualifying, sprint, qualifying] = await Promise.all(
        TREND_KEYS.map((k) =>
          loadLatestPrediction(bundle!, k).catch(() => undefined),
        ),
      );
      return { sprint_qualifying, sprint, qualifying } as TrendDocs;
    },
    enabled: !!bundle,
    staleTime: Infinity,
  });

  if (q.isError) {
    return (
      <Centered>Couldn't load race data: {(q.error as Error).message}</Centered>
    );
  }
  if (!bundle) return <Centered>Loading race week…</Centered>;

  const { manifest, docs, fetchErrors } = bundle;
  const pred = <K extends PredictionKey>(k: K) =>
    isHistory ? snap.data?.[k] : docs[k];
  const loadingSnap = isHistory && snap.isLoading;
  const sec = (k: keyof typeof manifest.sections) => manifest.sections[k];
  const fo = pred("finishing_order");
  const foStage = STAGE_LABEL[fo?.meta.stage ?? selected];
  const resultsPending =
    sec("results")?.status !== "ready" && sec("results")?.status !== "stale";
  const hasStrategies = !!docs.results?.race_strategies;
  const sections = SECTIONS.filter(
    ({ key }) => sec(key)?.status !== "not_applicable",
  );
  const trend = fo ? predictionColumns(docs.event, trendQ.data ?? {}, fo) : [];

  return (
    <RaceProvider event={docs.event}>
      <div className="min-h-screen">
        <Header
          manifest={manifest}
          event={docs.event}
          selectable={selectable}
          selected={selected}
          onSelect={(s) => setPicked(s === current ? null : s)}
          sections={sections.map(({ id, nav }) => ({ id, label: nav }))}
        />
        <main className="mx-auto grid max-w-[1440px] grid-cols-1 items-start gap-x-6 gap-y-10 px-4 pt-6 pb-16 md:px-12 lg:grid-cols-12">
          {fo && (
            <div className="lg:col-span-12">
              <Verdict
                doc={fo}
                stageLabel={foStage}
                result={
                  isHistory ? undefined : (docs.results?.race ?? undefined)
                }
              />
            </div>
          )}
          <SectionCard
            id="finishing"
            title="Predicted finishing order"
            prediction
            subtitle={
              fo &&
              `Made after ${foStage} · percentages are ${probNoun(fo.model.calibrated)}s`
            }
            className="lg:col-span-12"
            section={sec("finishing_order")}
            fetchError={fetchErrors.finishing_order}
            hasData={!!fo || loadingSnap}
            model={fo?.model}
            stageKey={selected}
          >
            {fo && (
              <FinishingOrderView
                doc={fo}
                stageLabel={foStage}
                trend={trend}
                results={docs.results}
                scored={!isHistory}
              />
            )}
          </SectionCard>

          <SectionCard
            id="strategy"
            title="Tyre strategy"
            prediction
            subtitle="Plans ranked by expected race time"
            className="lg:col-span-7 lg:self-stretch"
            section={sec("strategy")}
            fetchError={fetchErrors.strategy}
            hasData={!!pred("strategy") || loadingSnap}
            model={pred("strategy")?.model}
            stageKey={selected}
            aside={
              pred("strategy") && <CompoundLegend doc={pred("strategy")!} />
            }
          >
            {pred("strategy") && <StrategyView doc={pred("strategy")!} />}
          </SectionCard>
          <SectionCard
            id="risk"
            title="Safety car & red flag risk"
            prediction
            className="lg:col-span-5 lg:self-stretch"
            section={sec("race_incidents")}
            fetchError={fetchErrors.race_incidents}
            hasData={!!pred("race_incidents") || loadingSnap}
            model={pred("race_incidents")?.model}
            stageKey={selected}
          >
            {pred("race_incidents") && (
              <IncidentsView
                doc={pred("race_incidents")!}
                actual={docs.results?.race_incidents}
              />
            )}
          </SectionCard>

          <SectionCard
            id="stints"
            title="Race pace & strategies"
            subtitle={`${manifest.event_name} race · every driver, in finishing order`}
            className="lg:col-span-12"
            section={sec("results")}
            fetchError={fetchErrors.results}
            hasData={hasStrategies}
            emptyText={
              resultsPending ? undefined : "Available once the race has run."
            }
          >
            {docs.results && hasStrategies && (
              <RacePaceView doc={docs.results} />
            )}
          </SectionCard>

          <SectionCard
            id="weather"
            title="Weather"
            subtitle={docs.weather && `${docs.weather.source} · times in UTC`}
            className="lg:col-span-12"
            section={sec("weather")}
            fetchError={fetchErrors.weather}
            hasData={!!docs.weather}
            aside={
              docs.weather && (
                <WeatherLegend
                  hasTrack={docs.weather.sessions.some((s) => s.observed)}
                />
              )
            }
          >
            {docs.weather && <WeatherView weather={docs.weather} />}
          </SectionCard>

          <SectionCard
            id="story"
            title="Circuit story & fun facts"
            subtitle="Who won here, and what to watch this weekend"
            className="lg:col-span-7"
            section={sec("facts")}
            fetchError={fetchErrors.facts}
            hasData={!!docs.facts || !!docs.event}
          >
            <StoryView event={docs.event} facts={docs.facts} />
          </SectionCard>
          <SectionCard
            id="circuit"
            title="Circuit"
            subtitle={docs.event?.circuit.name}
            className="lg:col-span-5"
            section={sec("event")}
            fetchError={fetchErrors.event}
            hasData={!!docs.event}
          >
            {docs.event && <CircuitView event={docs.event} />}
          </SectionCard>

          <SectionCard
            id="results"
            title="Results & championship"
            subtitle="Classifications, qualifying and the standings"
            className="lg:col-span-12"
            section={sec("results")}
            fetchError={fetchErrors.results}
            hasData={!!docs.results}
          >
            {docs.results && <ResultsView doc={docs.results} />}
          </SectionCard>
        </main>
        <footer className="bg-foreground text-background">
          <div className="mx-auto grid max-w-[1440px] gap-6 px-4 py-10 text-sm md:grid-cols-3 md:px-12">
            <p className="cond text-2xl leading-tight font-black uppercase">
              Race Week
            </p>
            <p className="text-background/75">
              Ingested from FastF1, Jolpica and Open-Meteo into a Delta
              lakehouse on Databricks, scored by baselines and MLflow-registered
              models, and published here as static JSON by a GitHub Actions
              dispatcher after every session.
            </p>
            <p className="text-background/75 md:text-right">
              <a
                href="https://github.com/LizheZhao/race-preds"
                className="font-semibold text-background underline decoration-background/40 hover:decoration-background"
              >
                Source and pipeline on GitHub
              </a>
              <br />
              Not affiliated with Formula 1 or the FIA.
              <br />
              Set in Archivo,{" "}
              <a
                href={`${import.meta.env.BASE_URL}FONTS-LICENSE.txt`}
                className="underline decoration-background/40 hover:decoration-background"
              >
                SIL Open Font License
              </a>
              .
            </p>
          </div>
        </footer>
      </div>
    </RaceProvider>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}
