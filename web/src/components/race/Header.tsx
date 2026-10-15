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

const utcSlot = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });

interface Props {
  manifest: RaceManifest;
  event?: EventDoc | undefined;
  selectable: Set<Stage>;
  selected: Stage;
  onSelect: (s: Stage) => void;
  sections: NavItem[];
}

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
  // The race stage is only reached once the race has a result, so it is never "now".
  const final = current === "R";
  const race = event?.sessions.find((s) => s.id === "R");

  const raceStart = new Date(manifest.race_start_utc).getTime();
  // The session status can lag the clock; a race is over well within 3 hours of lights out.
  const pastRace = now != null && now > raceStart + RACE_OVER_MS;

  let clock: React.ReactNode = "—";
  let countdown = false;
  if (race?.status === "live" && !pastRace) clock = "Live";
  else if (race?.status === "completed" || pastRace) clock = "Finished";
  else if (now != null) {
    const diff = Math.max(0, raceStart - now);
    const d = Math.floor(diff / 864e5),
      h = Math.floor(diff / 36e5) % 24,
      m = Math.floor(diff / 6e4) % 60,
      s = Math.floor(diff / 1e3) % 60;
    const p = (n: number) => String(n).padStart(2, "0");
    countdown = true;
    clock = `${d}d ${p(h)}:${p(m)}:${p(s)}`;
  }

  const c = event?.circuit;
  const facts = [
    c && `${c.name}, ${c.country}`,
    `Round ${manifest.meta.round} · ${manifest.meta.season}`,
    manifest.format === "sprint_qualifying" ? "Sprint weekend" : null,
  ].filter(Boolean);

  return (
    <>
      <header>
        <div className="bg-band text-band-foreground">
          <div className="mx-auto max-w-[1440px] px-4 md:px-12">
            <div className="flex items-center justify-between gap-4 border-b border-band-foreground/25 py-2.5 text-sm">
              <span className="cond font-black tracking-[0.18em] uppercase">
                Race Week
              </span>
              <a
                href="https://github.com/LizheZhao/race-preds"
                className="text-band-foreground/85 underline decoration-band-foreground/40 hover:text-band-foreground hover:decoration-band-foreground"
              >
                How it's built
              </a>
            </div>
            <div className="flex flex-col gap-4 pt-5 md:flex-row md:items-end md:justify-between">
              <div className="min-w-0">
                <h1 className="xcond text-[clamp(2.5rem,5.5vw,4.5rem)] leading-[0.9] font-black tracking-[-0.01em]">
                  {manifest.event_name}
                </h1>
                <p className="mt-2 text-sm text-band-foreground/85 md:text-base">
                  {facts.join(" · ")}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-end gap-x-6 gap-y-3">
                <div className="md:text-right">
                  <p
                    className={cn(
                      "xcond flex items-baseline gap-2 text-4xl leading-none font-black uppercase tnum md:justify-end md:text-5xl",
                      clock === "Live" && "text-flag-yellow",
                    )}
                    aria-live="polite"
                  >
                    {countdown && (
                      <span className="cond text-sm font-bold tracking-[0.12em] text-band-foreground/80">
                        Lights out in
                      </span>
                    )}
                    {clock}
                  </p>
                  <p className="mt-1 text-xs text-band-foreground/80 tnum">
                    {new Date(manifest.race_start_utc)
                      .toUTCString()
                      .replace(":00 GMT", " UTC")}
                  </p>
                </div>
                <RunBarcode id={manifest.meta.run_id} />
              </div>
            </div>
          </div>

          <nav
            aria-label="Weekend stage"
            className="mt-5 border-t border-band-foreground/25"
          >
            <ol className="mx-auto grid max-w-[1440px] grid-cols-6 md:px-12">
              {stages.map((s, i) => {
                const done = i <= curIdx;
                const clickable = selectable.has(s);
                const isSel = s === selected;
                const session = event?.sessions.find((x) => x.id === s);
                return (
                  <li
                    key={s}
                    className="border-r border-band-foreground/25 first:border-l"
                  >
                    <button
                      type="button"
                      disabled={!clickable}
                      aria-current={isSel ? "step" : undefined}
                      onClick={() => onSelect(s)}
                      className={cn(
                        "group flex h-full w-full flex-col items-center gap-1.5 px-1 py-2.5 text-center transition-colors duration-200 md:flex-row md:gap-3 md:px-4 md:py-2.5 md:text-left",
                        isSel
                          ? "bg-background text-foreground"
                          : clickable
                            ? "cursor-pointer hover:bg-band-foreground/10"
                            : "cursor-default",
                        !done && !isSel && "text-band-foreground/55",
                      )}
                    >
                      <ZoneMark n={i} done={done} punched={isSel} />
                      <span className="min-w-0">
                        <span className="cond flex items-center gap-1.5 text-[13px] leading-tight font-extrabold tracking-[0.04em] uppercase md:text-[15px]">
                          <span className="md:hidden">
                            {s === "pre_weekend" ? "Pre" : s}
                          </span>
                          <span className="hidden md:inline">
                            {STAGE_LABEL[s]}
                          </span>
                          {s === current && (
                            <span
                              className={cn(
                                "hidden px-1 text-[11px] tracking-[0.1em] md:inline",
                                isSel
                                  ? "bg-foreground text-background"
                                  : "bg-band-foreground text-band",
                              )}
                            >
                              {final ? "Final" : "Now"}
                            </span>
                          )}
                        </span>
                        <span
                          className={cn(
                            "hidden text-[11px] tnum md:block",
                            isSel ? "text-muted-foreground" : "opacity-80",
                          )}
                        >
                          {session ? utcSlot(session.start_utc) : "Preview"}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>
        </div>
        <div className="mx-auto flex max-w-[1440px] flex-wrap justify-between gap-2 px-4 pt-3 text-xs text-muted-foreground md:px-12">
          <span>
            {selected === current
              ? final
                ? "Race finished. The last pre-race prediction is set against the result."
                : "Showing the latest predictions."
              : `Viewing the ${STAGE_LABEL[selected]} snapshot. `}
            {selected !== current && (
              <button
                className="font-semibold text-foreground underline"
                onClick={() => onSelect(current)}
              >
                Back to latest
              </button>
            )}
          </span>
          <span className="tnum">
            Published{" "}
            {now != null ? relTime(manifest.meta.generated_at, now) : "…"}
          </span>
        </div>
      </header>
      <div className="sticky top-0 z-20 mt-3 border-y border-border bg-background/95 backdrop-blur-sm">
        <div className="mx-auto max-w-[1440px] px-4 md:px-12">
          <SectionNav items={sections} />
        </div>
      </div>
    </>
  );
}

/** A zone number on the credential: filled once cleared, punched through when viewed. */
function ZoneMark({
  n,
  done,
  punched,
}: {
  n: number;
  done: boolean;
  punched: boolean;
}) {
  if (punched)
    return (
      <span
        aria-hidden
        className="punch-in grid size-8 shrink-0 place-items-center rounded-full bg-foreground text-sm font-black text-background xcond"
      >
        {n}
      </span>
    );
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-8 shrink-0 place-items-center text-sm font-black xcond",
        done
          ? "bg-band-foreground text-band"
          : "border border-band-foreground/50",
      )}
    >
      {n}
    </span>
  );
}

/** The publish run id, printed the way a credential prints its holder number. */
function RunBarcode({ id }: { id: string }) {
  const bars: { x: number; w: number }[] = [];
  let x = 0;
  for (const ch of id) {
    const v = ch.charCodeAt(0);
    bars.push({ x, w: 1 + (v % 3) });
    x += 2 + (v % 3) + ((v >> 2) % 3);
  }
  return (
    <div className="flex flex-col items-start gap-1 md:items-end">
      <svg
        viewBox={`0 0 ${x} 24`}
        width={Math.min(200, x * 1.4)}
        height={26}
        preserveAspectRatio="none"
        aria-hidden
      >
        {bars.map((b, i) => (
          <rect key={i} x={b.x} width={b.w} height={24} fill="currentColor" />
        ))}
      </svg>
      <span className="text-[11px] tracking-[0.06em] text-band-foreground/80 tnum">
        Run {id}
      </span>
    </div>
  );
}
