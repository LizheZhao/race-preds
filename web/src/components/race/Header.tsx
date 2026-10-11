import { useEffect, useState } from "react";
import type { EventDoc, RaceManifest, Stage } from "@/data/types";
import { cn } from "@/lib/utils";
import { relTime } from "./context";

export const STAGE_ORDER: Record<RaceManifest["format"], Stage[]> = {
  conventional: ["pre_weekend", "FP1", "FP2", "FP3", "Q", "R"],
  sprint_qualifying: ["pre_weekend", "FP1", "SQ", "S", "Q", "R"],
};
const STAGE_LABEL: Record<Stage, string> = {
  pre_weekend: "Pre",
  FP1: "FP1",
  FP2: "FP2",
  FP3: "FP3",
  SQ: "Sprint Q",
  S: "Sprint",
  Q: "Quali",
  R: "Race",
};

const RACE_OVER_MS = 3 * 36e5;

function useNow(ms = 1000) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

interface Props {
  manifest: RaceManifest;
  event?: EventDoc | undefined;
  selectable: Set<Stage>;
  selected: Stage;
  onSelect: (s: Stage) => void;
}

export function Header({
  manifest,
  event,
  selectable,
  selected,
  onSelect,
}: Props) {
  const now = useNow();
  const current = manifest.meta.stage ?? "pre_weekend";
  const stages = STAGE_ORDER[manifest.format];
  const curIdx = stages.indexOf(current);
  const race = event?.sessions.find((s) => s.id === "R");

  const raceStart = new Date(manifest.race_start_utc).getTime();
  // The session status can lag the clock; a race is over well within 3 hours of lights out.
  const pastRace = now != null && now > raceStart + RACE_OVER_MS;

  let clock: React.ReactNode = "—";
  if (race?.status === "live" && !pastRace)
    clock = <span className="text-primary">LIVE</span>;
  else if (race?.status === "completed" || pastRace) clock = "FINISHED";
  else if (now != null) {
    const diff = Math.max(0, raceStart - now);
    const d = Math.floor(diff / 864e5),
      h = Math.floor(diff / 36e5) % 24,
      m = Math.floor(diff / 6e4) % 60,
      s = Math.floor(diff / 1e3) % 60;
    const p = (n: number) => String(n).padStart(2, "0");
    clock = `${p(d)}d ${p(h)}:${p(m)}:${p(s)}`;
  }

  return (
    <header className="border-b border-border">
      <div className="mx-auto max-w-[1440px] px-4 py-6 md:px-8 md:py-8">
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="label-caps mb-2 flex items-center gap-2">
              <span className="inline-block h-3 w-1 bg-primary" />
              Race Week · Round {manifest.meta.round} · {manifest.meta.season}
            </p>
            <h1 className="text-3xl font-bold leading-none tracking-tight md:text-5xl">
              {manifest.event_name}
            </h1>
            {event && (
              <p className="mt-2 text-sm text-muted-foreground">
                {event.circuit.name} · {event.circuit.locality},{" "}
                {event.circuit.country}
              </p>
            )}
          </div>
          <div className="md:text-right">
            <p className="label-caps mb-1">Lights out</p>
            <p className="font-display text-3xl font-semibold tnum md:text-4xl">
              {clock}
            </p>
            <p className="mt-1 text-xs text-muted-foreground tnum">
              {new Date(manifest.race_start_utc)
                .toUTCString()
                .replace(":00 GMT", " UTC")}
            </p>
          </div>
        </div>

        <nav aria-label="Weekend stage" className="mt-8 overflow-x-auto">
          <ol className="flex min-w-[520px] gap-1">
            {stages.map((s, i) => {
              const done = i <= curIdx;
              const clickable = selectable.has(s);
              const isSel = s === selected;
              return (
                <li key={s} className="flex-1">
                  <button
                    type="button"
                    disabled={!clickable}
                    onClick={() => onSelect(s)}
                    className={cn(
                      "group w-full text-left transition-opacity",
                      clickable ? "cursor-pointer" : "cursor-default",
                      !done && "opacity-40",
                    )}
                  >
                    <span
                      className={cn(
                        "block h-1 rounded-full transition-colors",
                        isSel
                          ? "bg-primary"
                          : done
                            ? "bg-foreground/50 group-hover:bg-foreground/80"
                            : "bg-foreground/15",
                      )}
                    />
                    <span
                      className={cn(
                        "mt-2 flex items-center gap-1.5 font-display text-xs font-semibold uppercase tracking-wider",
                        isSel ? "text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {STAGE_LABEL[s]}
                      {s === current && (
                        <span className="rounded-sm bg-primary px-1 text-[9px] text-primary-foreground">
                          NOW
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>
        <div className="mt-3 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
          <span>
            {selected === current
              ? "Showing latest predictions"
              : `Viewing ${STAGE_LABEL[selected]} snapshot — `}
            {selected !== current && (
              <button
                className="text-foreground underline underline-offset-2"
                onClick={() => onSelect(current)}
              >
                back to latest
              </button>
            )}
          </span>
          <span className="tnum">
            updated{" "}
            {now != null ? relTime(manifest.meta.generated_at, now) : "…"}
          </span>
        </div>
      </div>
    </header>
  );
}
