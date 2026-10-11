import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Driver, EventDoc, Team } from "@/data/types";

interface Ctx {
  drivers: Map<string, Driver>;
  teams: Map<string, Team>;
  highlight: string | null;
  toggleHighlight: (id: string) => void;
  colorOf: (driverId: string) => string;
}
const RaceCtx = createContext<Ctx | null>(null);

export function RaceProvider({
  event,
  children,
}: {
  event?: EventDoc | undefined;
  children: ReactNode;
}) {
  const [highlight, setHighlight] = useState<string | null>(null);
  const value = useMemo<Ctx>(() => {
    const drivers = new Map((event?.drivers ?? []).map((d) => [d.id, d]));
    const teams = new Map((event?.teams ?? []).map((t) => [t.id, t]));
    return {
      drivers,
      teams,
      highlight,
      toggleHighlight: (id) => setHighlight((h) => (h === id ? null : id)),
      colorOf: (id) =>
        teams.get(drivers.get(id)?.team_id ?? "")?.color ?? "var(--subtle)",
    };
  }, [event, highlight]);
  return <RaceCtx.Provider value={value}>{children}</RaceCtx.Provider>;
}

export function useRace() {
  const c = useContext(RaceCtx);
  if (!c) throw new Error("RaceProvider missing");
  return c;
}

/** Honest wording: "chance" only when the model is calibrated. */
export function probNoun(calibrated: boolean) {
  return calibrated ? "chance" : "model score";
}

export function pct(p: number, digits = 1) {
  return `${(p * 100).toFixed(digits)}%`;
}

export function relTime(iso: string, now = Date.now()) {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = s / 60;
  if (m < 60) return `${Math.round(m)} min ago`;
  const h = m / 60;
  if (h < 48) return `${Math.round(h)} h ago`;
  const d = h / 24;
  if (d < 60) return `${Math.round(d)} days ago`;
  return `${Math.round(d / 30)} months ago`;
}
