// The only module that fetches data. Point VITE_DATA_BASE_URL at another host to switch sources.
import type {
  EventDoc,
  FactsDoc,
  FinishingOrderDoc,
  QualifyingDoc,
  RaceIncidentsDoc,
  RaceManifest,
  ResultsDoc,
  SeasonIndex,
  SectionKey,
  Stage,
  StrategyDoc,
  WeatherDoc,
  PredictionKey,
  RoundSummary,
} from "./types";

// Relative to the site's base path, so it works under GitHub Pages' /race-preds/.
export const DATA_BASE_URL: string =
  (import.meta.env["VITE_DATA_BASE_URL"] as string | undefined)?.replace(
    /\/$/,
    "",
  ) ?? `${import.meta.env.BASE_URL}data/v1`;

/**
 * GitHub Pages caches every file for 10 minutes and the headers can't be changed, so files
 * that are rewritten in place carry a query string that changes when their content does:
 * index.json and manifest.json a timestamp, section documents the manifest's updated_at.
 * Stage snapshots never change after publish and need none.
 */
export function withVersion(
  url: string,
  version: string | number | null | undefined,
) {
  return version == null
    ? url
    : `${url}?v=${encodeURIComponent(String(version))}`;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  return (await res.json()) as T;
}

export interface SectionDocs {
  event?: EventDoc;
  weather?: WeatherDoc;
  facts?: FactsDoc;
  results?: ResultsDoc;
  finishing_order?: FinishingOrderDoc;
  qualifying?: QualifyingDoc;
  strategy?: StrategyDoc;
  race_incidents?: RaceIncidentsDoc;
}
export interface RoundBundle {
  index: SeasonIndex;
  round: RoundSummary;
  manifest: RaceManifest;
  roundDir: string;
  docs: SectionDocs;
  /** Per-section fetch errors (document missing although manifest listed it). */
  fetchErrors: Partial<Record<SectionKey, string>>;
}

function manifestUrl(index: SeasonIndex, round: RoundSummary) {
  const rel =
    round.manifest_path ?? `${index.meta.season}/${round.round}/manifest.json`;
  return `${DATA_BASE_URL}/${rel}`;
}

const LOADABLE: (keyof SectionDocs)[] = [
  "event",
  "weather",
  "facts",
  "results",
  "finishing_order",
  "qualifying",
  "strategy",
  "race_incidents",
];

/** Hop 1 → index, hop 2 → manifest, hop 3 → every section document in parallel. */
export async function loadCurrentRound(): Promise<RoundBundle> {
  const now = Date.now();
  const index = await getJson<SeasonIndex>(
    withVersion(`${DATA_BASE_URL}/index.json`, now),
  );
  const round = index.rounds.find((r) => r.round === index.current_round);
  if (!round) throw new Error("No current round in index.json");
  const mUrl = manifestUrl(index, round);
  const manifest = await getJson<RaceManifest>(withVersion(mUrl, now));
  const roundDir = mUrl.slice(0, mUrl.lastIndexOf("/"));

  const docs: SectionDocs = {};
  const fetchErrors: RoundBundle["fetchErrors"] = {};
  await Promise.all(
    LOADABLE.map(async (key) => {
      const s = manifest.sections[key];
      if (!s || !s.path || (s.status !== "ready" && s.status !== "stale"))
        return;
      try {
        (docs as Record<string, unknown>)[key] = await getJson(
          withVersion(`${roundDir}/${s.path}`, s.updated_at),
        );
      } catch (e) {
        fetchErrors[key] = (e as Error).message;
      }
    }),
  );
  return { index, round, manifest, roundDir, docs, fetchErrors };
}

/** Path of a historical stage snapshot: same folder as the current path, file named {stage}.json. */
export function stagePath(currentPath: string, stage: Stage) {
  const i = currentPath.lastIndexOf("/");
  return `${i >= 0 ? currentPath.slice(0, i + 1) : ""}${stage}.json`;
}

/** One prediction document at an earlier stage, or undefined if the manifest has no such snapshot. */
export async function loadStageDoc<K extends PredictionKey>(
  bundle: RoundBundle,
  key: K,
  stage: Stage,
): Promise<SectionDocs[K] | undefined> {
  const s = bundle.manifest.sections[key];
  if (!s?.path) return undefined;
  if (stage === s.stage) return bundle.docs[key];
  if (!(s.history ?? []).includes(stage)) return undefined;
  return getJson<SectionDocs[K]>(
    `${bundle.roundDir}/${stagePath(s.path, stage)}`,
  );
}

/** All prediction documents for an earlier stage (only those whose history lists it). */
export async function loadStageSnapshots(bundle: RoundBundle, stage: Stage) {
  const out: Partial<Pick<SectionDocs, PredictionKey>> = {};
  const keys: PredictionKey[] = [
    "finishing_order",
    "qualifying",
    "strategy",
    "race_incidents",
  ];
  await Promise.all(
    keys.map(async (key) => {
      try {
        const doc = await loadStageDoc(bundle, key, stage);
        if (doc) (out as Record<string, unknown>)[key] = doc;
      } catch {
        /* missing snapshot: card shows "no snapshot" */
      }
    }),
  );
  return out;
}
