import type { EventDoc, FactsDoc } from "@/data/types";
import { cn } from "@/lib/utils";
import { useRace } from "./context";

export function StoryView({
  event,
  facts,
}: {
  event?: EventDoc | undefined;
  facts?: FactsDoc | undefined;
}) {
  const winners = [...(event?.circuit.past_winners ?? [])].sort(
    (a, b) => b.season - a.season,
  );
  const story = event?.circuit.story;
  return (
    <div className="grid gap-6">
      <div className="grid gap-6 md:grid-cols-[minmax(0,230px)_minmax(0,1fr)]">
        {winners.length > 0 && (
          <section>
            <h3 className="label-caps mb-2.5">Past winners</h3>
            <ul>
              {winners.map((w) => (
                <li
                  key={w.season}
                  className="flex h-7 items-center gap-2.5 border-t border-border text-sm"
                >
                  <span className="w-9 shrink-0 text-muted-foreground tnum">
                    {w.season}
                  </span>
                  <span className="truncate font-semibold">
                    {w.driver_name}
                  </span>
                  <span className="ml-auto truncate text-[11px] text-muted-foreground">
                    {w.team_name}
                  </span>
                </li>
              ))}
            </ul>
            {story?.designer && (
              <p className="mt-3 text-xs text-muted-foreground">
                Designed by{" "}
                <span className="text-foreground">{story.designer}</span>
              </p>
            )}
          </section>
        )}
        {story?.moments?.length ? (
          <section className="min-w-0 md:col-start-2">
            <h3 className="label-caps mb-2.5">Moments here</h3>
            <ol className="grid">
              {story.moments.map((m, i) => (
                <li
                  key={`${m.season}-${i}`}
                  className="grid grid-cols-[44px_14px_minmax(0,1fr)] gap-2.5"
                >
                  <span className="pt-px text-right font-display text-[15px] font-bold tnum">
                    {m.season}
                  </span>
                  <span className="relative before:absolute before:inset-y-0 before:left-1.5 before:w-px before:bg-border after:absolute after:left-[2px] after:top-1.5 after:size-[9px] after:rounded-full after:bg-foreground" />
                  <div className="pb-3.5">
                    <a
                      href={m.source}
                      target="_blank"
                      rel="noreferrer"
                      className="font-display text-sm font-semibold hover:underline"
                    >
                      {m.headline}
                    </a>
                    {m.body && (
                      <p className="text-xs text-muted-foreground">{m.body}</p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        ) : null}
      </div>
      {facts && (
        <section className="min-w-0">
          <h3 className="label-caps mb-2.5">Facts</h3>
          <FactCards doc={facts} />
        </section>
      )}
    </div>
  );
}

function FactCards({ doc }: { doc: FactsDoc }) {
  const { colorOf, highlight, toggleHighlight } = useRace();
  return (
    <ul className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(200px,1fr))]">
      {doc.facts.map((f) => {
        const ids = f.driver_ids ?? [];
        const on = highlight != null && ids.includes(highlight);
        const dim = highlight != null && !on;
        return (
          <li
            key={f.id}
            onClick={ids[0] ? () => toggleHighlight(ids[0]!) : undefined}
            className={cn(
              " border border-border px-3.5 py-3 transition-opacity duration-200",
              ids[0] && "cursor-pointer",
              dim && "opacity-35",
              on && "bg-foreground/5",
            )}
            style={
              ids.length
                ? { borderLeft: `3px solid ${colorOf(ids[0]!)}` }
                : undefined
            }
          >
            <span className="label-caps">{f.category}</span>
            <h4 className="mt-1.5 font-display text-[15px] font-semibold leading-snug">
              {f.headline}
            </h4>
            {f.body && (
              <p className="mt-1 text-xs text-muted-foreground">{f.body}</p>
            )}
            <p className="mt-2 text-[11px] text-subtle">{f.source}</p>
          </li>
        );
      })}
    </ul>
  );
}
