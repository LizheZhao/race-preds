import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { loadCurrentRound, loadStageDoc, loadStageSnapshots } from "@/data/api";
import type { PredictionKey, Stage } from "@/data/types";
import { PREDICTION_KEYS } from "@/data/types";
import { RaceProvider } from "@/components/race/context";
import { Header, STAGE_LABEL, STAGE_ORDER } from "@/components/race/Header";
import { SectionCard } from "@/components/race/SectionCard";
import { CircuitView } from "@/components/race/CircuitCard";
import { WeatherView } from "@/components/race/WeatherCard";
import { FinishingOrderView } from "@/components/race/FinishingOrder";
import { QualifyingView } from "@/components/race/Qualifying";
import { StrategyView } from "@/components/race/Strategy";
import { IncidentsView } from "@/components/race/Incidents";
import { FactsView, StandingsView } from "@/components/race/FactsStandings";
import { ResultsView } from "@/components/race/Results";
import { Verdict } from "@/components/race/Verdict";

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

  // Finishing order snapshots in weekend order, for the trend chart.
  const foSection = bundle?.manifest.sections["finishing_order"];
  const foStages = order.filter(
    (s) => s === foSection?.stage || (foSection?.history ?? []).includes(s),
  );
  const foShown = isHistory ? selected : foSection?.stage;
  const trendQ = useQuery({
    queryKey: ["fo-trend", roundKey, foSection?.updated_at],
    queryFn: () =>
      Promise.all(
        foStages.map(async (stage) => ({
          stage,
          doc: await loadStageDoc(bundle!, "finishing_order", stage),
        })),
      ),
    enabled: !!bundle && foStages.length > 1,
    staleTime: Infinity,
  });
  const trend = (trendQ.data ?? [])
    .filter((t) => order.indexOf(t.stage) <= order.indexOf(foShown ?? current))
    .flatMap((t) =>
      t.doc ? [{ label: STAGE_LABEL[t.stage], doc: t.doc }] : [],
    );

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
  const foLabel = STAGE_LABEL[pred("finishing_order")?.meta.stage ?? selected];
  const raceResult = isHistory ? undefined : (docs.results?.race ?? undefined);

  return (
    <RaceProvider event={docs.event}>
      <div className="min-h-screen">
        <Header
          manifest={manifest}
          event={docs.event}
          selectable={selectable}
          selected={selected}
          onSelect={(s) => setPicked(s === current ? null : s)}
        />
        <main className="mx-auto grid max-w-[1440px] grid-cols-1 items-start gap-x-6 gap-y-10 px-4 pt-6 pb-16 md:px-12 lg:grid-cols-12">
          <div className="lg:col-span-12">
            {pred("finishing_order") && (
              <Verdict
                doc={pred("finishing_order")!}
                stageLabel={foLabel}
                result={raceResult}
              />
            )}
          </div>
          <SectionCard
            title="Finishing order"
            prediction
            className="lg:col-span-8 lg:row-span-2"
            section={sec("finishing_order")}
            fetchError={fetchErrors.finishing_order}
            hasData={!!pred("finishing_order") || loadingSnap}
            model={pred("finishing_order")?.model}
            stageKey={selected}
          >
            {pred("finishing_order") && (
              <FinishingOrderView
                doc={pred("finishing_order")!}
                stageLabel={foLabel}
                trend={trend}
                result={raceResult}
              />
            )}
          </SectionCard>
          <SectionCard
            title="Race control risk"
            prediction
            className="lg:col-span-4"
            section={sec("race_incidents")}
            fetchError={fetchErrors.race_incidents}
            hasData={!!pred("race_incidents") || loadingSnap}
            model={pred("race_incidents")?.model}
            stageKey={selected}
          >
            {pred("race_incidents") && (
              <IncidentsView doc={pred("race_incidents")!} />
            )}
          </SectionCard>
          <SectionCard
            title="Tyre strategy"
            prediction
            className="lg:col-span-7 lg:row-start-4"
            section={sec("strategy")}
            fetchError={fetchErrors.strategy}
            hasData={!!pred("strategy") || loadingSnap}
            model={pred("strategy")?.model}
            stageKey={selected}
          >
            {pred("strategy") && <StrategyView doc={pred("strategy")!} />}
          </SectionCard>
          <SectionCard
            title="Weather"
            className="lg:col-span-4 lg:col-start-9 lg:row-start-3"
            section={sec("weather")}
            fetchError={fetchErrors.weather}
            hasData={!!docs.weather}
          >
            {docs.weather && <WeatherView weather={docs.weather} />}
          </SectionCard>
          <SectionCard
            title="Circuit"
            className="lg:col-span-5"
            section={sec("event")}
            fetchError={fetchErrors.event}
            hasData={!!docs.event}
          >
            {docs.event && <CircuitView event={docs.event} />}
          </SectionCard>
          <SectionCard
            title="Qualifying"
            prediction
            className="lg:col-span-12"
            section={sec("qualifying")}
            fetchError={fetchErrors.qualifying}
            hasData={!!pred("qualifying") || loadingSnap}
            model={pred("qualifying")?.model}
            stageKey={selected}
          >
            {pred("qualifying") && <QualifyingView doc={pred("qualifying")!} />}
          </SectionCard>
          <SectionCard
            title="Championship"
            className="lg:col-span-7"
            section={sec("event")}
            fetchError={fetchErrors.event}
            hasData={!!docs.event}
          >
            {docs.event && <StandingsView event={docs.event} />}
          </SectionCard>
          <SectionCard
            title="Notes from the data"
            className="lg:col-span-5"
            section={sec("facts")}
            fetchError={fetchErrors.facts}
            hasData={!!docs.facts}
          >
            {docs.facts && <FactsView doc={docs.facts} />}
          </SectionCard>
          <SectionCard
            title="Results"
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
            <p className="cond text-2xl leading-tight font-black uppercase md:col-span-1">
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
