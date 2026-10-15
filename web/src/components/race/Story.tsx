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
  return (
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
                <span className="truncate font-semibold">{w.driver_name}</span>
                <span className="ml-auto truncate text-[11px] text-muted-foreground">
                  {w.team_name}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {facts && (
        <section className="min-w-0 md:col-start-2">
          <h3 className="label-caps mb-2.5">This weekend</h3>
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
              "rounded-[4px] border border-border px-3.5 py-3 transition-opacity duration-200",
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
            <p className="mt-2 text-[10px] text-subtle">{f.source}</p>
          </li>
        );
      })}
    </ul>
  );
}
