import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { loadCurrentRound, loadStageDoc, loadStageSnapshots } from "@/data/api";
import type { PredictionKey, Stage } from "@/data/types";
import { PREDICTION_KEYS } from "@/data/types";
import { RaceProvider } from "@/components/race/context";
import { Header, STAGE_ORDER } from "@/components/race/Header";
import { SectionCard } from "@/components/race/SectionCard";
import { CircuitView } from "@/components/race/CircuitCard";
import { WeatherView } from "@/components/race/WeatherCard";
import { FinishingOrderView } from "@/components/race/FinishingOrder";
import { QualifyingView } from "@/components/race/Qualifying";
import { StrategyView } from "@/components/race/Strategy";
import { IncidentsView } from "@/components/race/Incidents";
import { FactsView, StandingsView } from "@/components/race/FactsStandings";
import { ResultsView } from "@/components/race/Results";

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

  // Stage list for each prediction section: history + current, in weekend order.
  const order = bundle ? STAGE_ORDER[bundle.manifest.format] : [];
  const selectable = useMemo(() => {
    const s = new Set<Stage>([current]);
    if (bundle)
      for (const k of PREDICTION_KEYS)
        for (const h of bundle.manifest.sections[k]?.history ?? []) s.add(h);
    return s;
  }, [bundle, current]);

  // Previous stage for the "Movers" slope chart.
  const foSection = bundle?.manifest.sections["finishing_order"];
  const foStages = order.filter(
    (s) => s === current || (foSection?.history ?? []).includes(s),
  );
  const prevStage = foStages[foStages.indexOf(selected) - 1];
  const prevQ = useQuery({
    queryKey: ["fo-prev", roundKey, prevStage],
    queryFn: () => loadStageDoc(bundle!, "finishing_order", prevStage!),
    enabled: !!bundle && !!prevStage,
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
        <main className="mx-auto grid max-w-[1440px] grid-cols-1 gap-4 px-4 py-6 md:px-8 lg:grid-cols-12 lg:gap-5">
          <SectionCard
            title="Predicted finishing order"
            className="lg:col-span-12"
            section={sec("finishing_order")}
            fetchError={fetchErrors.finishing_order}
            hasData={!!pred("finishing_order") || loadingSnap}
            model={pred("finishing_order")?.model}
            stageKey={selected}
          >
            {pred("finishing_order") && (
              <FinishingOrderView
                doc={pred("finishing_order")!}
                prev={prevQ.data}
                prevLabel={prevStage === "pre_weekend" ? "Pre" : prevStage}
                nowLabel={selected === "pre_weekend" ? "Pre" : selected}
              />
            )}
          </SectionCard>

          <SectionCard
            title="Predicted qualifying"
            className="lg:col-span-7"
            section={sec("qualifying")}
            fetchError={fetchErrors.qualifying}
            hasData={!!pred("qualifying") || loadingSnap}
            model={pred("qualifying")?.model}
            stageKey={selected}
          >
            {pred("qualifying") && <QualifyingView doc={pred("qualifying")!} />}
          </SectionCard>

          <SectionCard
            title="Safety car & red flag risk"
            className="lg:col-span-5"
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
            className="lg:col-span-7"
            section={sec("strategy")}
            fetchError={fetchErrors.strategy}
            hasData={!!pred("strategy") || loadingSnap}
            model={pred("strategy")?.model}
            stageKey={selected}
          >
            {pred("strategy") && <StrategyView doc={pred("strategy")!} />}
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
            title="Weather"
            className="lg:col-span-7"
            section={sec("weather")}
            fetchError={fetchErrors.weather}
            hasData={!!docs.weather}
          >
            {docs.weather && <WeatherView weather={docs.weather} />}
          </SectionCard>

          <SectionCard
            title="Championship"
            className="lg:col-span-5"
            section={sec("event")}
            fetchError={fetchErrors.event}
            hasData={!!docs.event}
          >
            {docs.event && <StandingsView event={docs.event} />}
          </SectionCard>

          <SectionCard
            title="Fun facts"
            className="lg:col-span-12"
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
