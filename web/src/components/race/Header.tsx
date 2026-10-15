import { useEffect, useState } from "react";
import type { EventDoc, RaceManifest, Stage } from "@/data/types";
import { cn } from "@/lib/utils";
import { relTime } from "./context";
import { SectionNav, type NavItem } from "./SectionNav";

export const STAGE_ORDER: Record<RaceManifest["format"], Stage[]> = {
  conventional: ["pre_weekend", "FP1", "FP2", "FP3", "Q", "R"],
  sprint_qualifying: ["pre_weekend", "FP1", "SQ", "S", "Q", "R"],
};
export const STAGE_LABEL: Record<Stage, string> = {
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
  sections: NavItem[];
}

const DAY_FMT: Intl.DateTimeFormatOptions = {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
};

export function Header({
  manifest,
  event,
  selectable,
  selected,
  onSelect,
  sections,
}: Props) {
  const now = useNow();
  const current = manifest.meta.stage ?? "pre_weekend";
  const stages = STAGE_ORDER[manifest.format];
  const curIdx = stages.indexOf(current);
  const race = event?.sessions.find((s) => s.id === "R");

  const raceStart = new Date(manifest.race_start_utc).getTime();
  // The session status can lag the clock; a race is over well within 3 hours of lights out.
  const finished =
    race?.status === "completed" ||
    (now != null && now > raceStart + RACE_OVER_MS);
  const live = race?.status === "live" && !finished;

  let status: React.ReactNode = "";
  if (finished) status = "race finished";
  else if (live) status = <span className="text-primary">LIVE</span>;
  else if (now != null) {
    const diff = Math.max(0, raceStart - now);
    const d = Math.floor(diff / 864e5),
      h = Math.floor(diff / 36e5) % 24,
      m = Math.floor(diff / 6e4) % 60,
      s = Math.floor(diff / 1e3) % 60;
    const p = (n: number) => String(n).padStart(2, "0");
    status = `lights out in ${d}d ${p(h)}:${p(m)}:${p(s)}`;
  }
  const day = new Date(manifest.race_start_utc).toLocaleDateString(
    "en-GB",
    DAY_FMT,
  );

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur-md">
      <div className="mx-auto max-w-[1440px] px-4 md:px-8">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 py-2.5">
          <div className="min-w-0">
            <h1 className="font-display text-[22px] font-bold leading-none">
              {manifest.event_name}
            </h1>
            <p className="mt-1 truncate text-xs text-muted-foreground tnum">
              Round {manifest.meta.round} ·{" "}
              {event?.circuit.locality ?? manifest.meta.season} · {day}
              {status && <> · {status}</>}
            </p>
          </div>
          <div className="ml-auto hidden items-center gap-3 sm:flex">
            <ol aria-label="Weekend stage" className="flex gap-1">
              {stages.map((s, i) => {
                const clickable = selectable.has(s);
                return (
                  <li key={s}>
                    <button
                      type="button"
                      disabled={!clickable}
                      aria-pressed={s === selected}
                      onClick={() => onSelect(s)}
                      className={cn(
                        "flex items-center gap-1.5 rounded-[3px] border px-2 py-1 font-display text-[11px] font-semibold uppercase tracking-[0.08em] transition-colors",
                        s === selected
                          ? "border-foreground bg-foreground text-background"
                          : "border-border text-muted-foreground",
                        clickable && s !== selected && "hover:text-foreground",
                        i > curIdx && "opacity-40",
                      )}
                    >
                      {s === current && s !== selected && (
                        <span className="size-1.5 rounded-full bg-primary" />
                      )}
                      {STAGE_LABEL[s]}
                    </button>
                  </li>
                );
              })}
            </ol>
            {selected !== current ? (
              <button
                className="text-xs text-foreground underline underline-offset-2"
                onClick={() => onSelect(current)}
              >
                back to latest
              </button>
            ) : (
              <span className="text-xs text-muted-foreground tnum">
                updated{" "}
                {now != null ? relTime(manifest.meta.generated_at, now) : "…"}
              </span>
            )}
          </div>
        </div>
        <SectionNav items={sections} />
      </div>
    </header>
  );
}
