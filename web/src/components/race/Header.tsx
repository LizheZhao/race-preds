import { useEffect, useState, type ReactNode } from "react";
import type { EventDoc, RaceManifest } from "@/data/types";
import { cn } from "@/lib/utils";
import { relTime } from "./context";
import { SectionNav, type NavItem } from "./SectionNav";

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
  sections: NavItem[];
}

export function Header({ manifest, event, sections }: Props) {
  const now = useNow();
  const race = event?.sessions.find((s) => s.id === "R");

  const raceStart = new Date(manifest.race_start_utc).getTime();
  // The session status can lag the clock; a race is over well within 3 hours of lights out.
  const pastRace = now != null && now > raceStart + RACE_OVER_MS;

  let clock: ReactNode = "—";
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
          <div className="mx-auto max-w-[1440px] px-4 pb-6 md:px-12">
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
        </div>
      </header>
      <div className="sticky top-0 z-20 border-t border-band-foreground/25 bg-band text-band-foreground">
        <div className="mx-auto max-w-[1440px] px-4 md:px-12">
          <SectionNav items={sections} />
        </div>
      </div>
      <p className="mx-auto max-w-[1440px] px-4 pt-3 text-right text-xs text-muted-foreground tnum md:px-12">
        Published {now != null ? relTime(manifest.meta.generated_at, now) : "…"}
      </p>
    </>
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
