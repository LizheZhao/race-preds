import { useId } from "react";
import type { EventDoc, Stage } from "@/data/types";
import { cn } from "@/lib/utils";
import { RACE, STAGE_LABEL, type StageTile } from "./stages";

const utcSlot = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });

/** The weekend's stages as access zones; picking one chooses the prediction snapshot the card shows. */
export function StageStrip({
  tiles,
  selected,
  current,
  sessions,
  onSelect,
}: {
  tiles: StageTile[];
  selected: Stage;
  /** The stage the pipeline has reached: tagged NOW, or FINAL once the race has run. */
  current: Stage;
  sessions: EventDoc["sessions"] | undefined;
  onSelect: (stage: Stage) => void;
}) {
  const labelId = useId();
  return (
    <div>
      <p id={labelId} className="label-caps mb-2">
        Prediction made after
      </p>
      <nav aria-labelledby={labelId}>
        <ol className="grid grid-cols-6 border border-foreground">
          {tiles.map(({ stage, state }, i) => {
            const isSel = stage === selected;
            const session = sessions?.find((x) => x.id === stage);
            const sub =
              state === "no_data"
                ? "No data"
                : session
                  ? utcSlot(session.start_utc)
                  : "Preview";
            return (
              <li
                key={stage}
                className="border-r border-border last:border-r-0"
              >
                <button
                  type="button"
                  disabled={state !== "snapshot"}
                  aria-current={isSel ? "step" : undefined}
                  title={
                    state === "no_data"
                      ? `No prediction was published after ${STAGE_LABEL[stage]}`
                      : undefined
                  }
                  onClick={() => onSelect(stage)}
                  className={cn(
                    "flex h-full w-full flex-col items-center gap-1.5 px-1 py-2.5 text-center transition-colors duration-200 md:flex-row md:gap-3 md:px-4 md:text-left",
                    isSel
                      ? "bg-foreground text-background"
                      : state === "snapshot"
                        ? "cursor-pointer hover:bg-muted"
                        : "cursor-not-allowed text-subtle",
                    !isSel && state === "no_data" && "hatch-muted",
                    !isSel && state === "upcoming" && "bg-card",
                  )}
                >
                  <ZoneMark n={i} state={state} punched={isSel} />
                  <span className="min-w-0">
                    <span className="cond flex items-center gap-1.5 text-[13px] leading-tight font-extrabold tracking-[0.04em] uppercase md:text-[15px]">
                      <span className="md:hidden">
                        {stage === "pre_weekend" ? "Pre" : stage}
                      </span>
                      <span className="hidden md:inline">
                        {STAGE_LABEL[stage]}
                      </span>
                      {stage === current && (
                        <span
                          className={cn(
                            "hidden px-1 text-[11px] tracking-[0.1em] md:inline",
                            isSel
                              ? "bg-background text-foreground"
                              : "bg-foreground text-background",
                          )}
                        >
                          {current === RACE ? "Final" : "Now"}
                        </span>
                      )}
                    </span>
                    <span
                      className={cn(
                        "hidden text-[11px] tnum md:block",
                        isSel ? "opacity-75" : "text-muted-foreground",
                        !isSel && state !== "snapshot" && "text-subtle",
                      )}
                    >
                      {sub}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>
    </div>
  );
}

/** A zone number: band blue when a snapshot exists, outlined when not, punched through when viewed. */
function ZoneMark({
  n,
  state,
  punched,
}: {
  n: number;
  state: StageTile["state"];
  punched: boolean;
}) {
  const base =
    "xcond grid size-8 shrink-0 place-items-center text-sm font-black";
  if (punched)
    return (
      <span
        aria-hidden
        className={cn(
          base,
          "punch-in rounded-full bg-background text-foreground",
        )}
      >
        {n}
      </span>
    );
  return (
    <span
      aria-hidden
      className={cn(
        base,
        state === "snapshot"
          ? "bg-band text-band-foreground"
          : cn("border border-subtle", state === "no_data" && "border-dashed"),
      )}
    >
      {n}
    </span>
  );
}
