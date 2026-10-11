import { useState } from "react";
import type { EventDoc, FactsDoc } from "@/data/types";
import { cn } from "@/lib/utils";
import { useRace } from "./context";

export function FactsView({ doc }: { doc: FactsDoc }) {
  const { colorOf, highlight } = useRace();
  return (
    <div className="-mx-1 overflow-x-auto px-1 pb-1">
      <ul className="flex gap-3">
        {doc.facts.map((f) => {
          const ids = f.driver_ids ?? [];
          const on = highlight != null && ids.includes(highlight);
          const dim = highlight != null && !on;
          return (
            <li
              key={f.id}
              className={cn(
                "w-72 shrink-0 rounded-sm border border-border bg-background/40 p-4 transition-opacity duration-200",
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
              <h3 className="mt-2 text-base font-semibold leading-snug">
                {f.headline}
              </h3>
              {f.body && (
                <p className="mt-1.5 text-sm text-muted-foreground">{f.body}</p>
              )}
              <p className="mt-3 text-[10px] text-subtle">{f.source}</p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function StandingsView({ event }: { event: EventDoc }) {
  const { drivers, teams, colorOf, highlight, toggleHighlight } = useRace();
  const [all, setAll] = useState(false);
  const lim = all ? Infinity : 10;
  const ds = [...event.standings.drivers]
    .sort((a, b) => a.position - b.position)
    .slice(0, lim);
  const ts = [...event.standings.teams]
    .sort((a, b) => a.position - b.position)
    .slice(0, lim);
  const leader = ds[0];
  return (
    <div className="space-y-5">
      {leader && (
        <div>
          <p className="label-caps mb-1">
            Leader
            {event.standings.after_round != null
              ? ` after R${event.standings.after_round}`
              : ""}
          </p>
          <p className="font-display text-4xl font-semibold leading-none tnum">
            {drivers.get(leader.driver_id)?.code}{" "}
            <span className="text-base font-normal text-muted-foreground">
              {leader.points} pts
            </span>
          </p>
        </div>
      )}
      <div className="grid gap-6 sm:grid-cols-2">
        <Table
          head="Drivers"
          rows={ds.map((d) => ({
            key: d.driver_id,
            pos: d.position,
            color: colorOf(d.driver_id),
            name: drivers.get(d.driver_id)?.last_name ?? d.driver_id,
            pts: d.points,
            wins: d.wins,
            active: highlight === d.driver_id,
            dim: highlight != null && highlight !== d.driver_id,
            onClick: () => toggleHighlight(d.driver_id),
          }))}
        />
        <Table
          head="Teams"
          rows={ts.map((t) => ({
            key: t.team_id,
            pos: t.position,
            color: teams.get(t.team_id)?.color ?? "var(--subtle)",
            name: teams.get(t.team_id)?.name ?? t.team_id,
            pts: t.points,
            wins: t.wins,
          }))}
        />
      </div>
      {(event.standings.drivers.length > 10 ||
        event.standings.teams.length > 10) && (
        <button
          className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          onClick={() => setAll((v) => !v)}
        >
          {all ? "Show top 10" : "Show all"}
        </button>
      )}
    </div>
  );
}

function Table({
  head,
  rows,
}: {
  head: string;
  rows: {
    key: string;
    pos: number;
    color: string;
    name: string;
    pts: number;
    wins: number;
    active?: boolean;
    dim?: boolean;
    onClick?: () => void;
  }[];
}) {
  return (
    <table className="w-full text-sm tnum">
      <thead>
        <tr className="label-caps text-left">
          <th className="pb-2 font-semibold">{head}</th>
          <th />
          <th className="pb-2 text-right font-semibold">Pts</th>
          <th className="pb-2 text-right font-semibold">W</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr
            key={r.key}
            onClick={r.onClick}
            className={cn(
              "border-t border-border transition-opacity",
              r.onClick && "cursor-pointer",
              r.dim && "opacity-35",
              r.active && "bg-foreground/5",
            )}
          >
            <td className="w-7 py-1.5 text-muted-foreground">{r.pos}</td>
            <td className="py-1.5">
              <span
                className="mr-2 inline-block h-3 w-[3px] align-middle"
                style={{ background: r.color }}
              />
              {r.name}
            </td>
            <td className="py-1.5 text-right">{r.pts}</td>
            <td className="py-1.5 text-right text-muted-foreground">
              {r.wins}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
