import { useState } from "react";
import type { EventDoc, FactsDoc } from "@/data/types";
import { cn } from "@/lib/utils";
import { useRace } from "./context";

export function FactsView({ doc }: { doc: FactsDoc }) {
  const { colorOf, highlight } = useRace();
  return (
    <ul>
      {doc.facts.map((f) => {
        const ids = f.driver_ids ?? [];
        const on = highlight != null && ids.includes(highlight);
        const dim = highlight != null && !on;
        return (
          <li
            key={f.id}
            className={cn(
              "grid gap-x-6 gap-y-2 border-b border-border py-4 transition-opacity duration-200 first:pt-0 sm:grid-cols-[7rem_minmax(0,1fr)]",
              dim && "opacity-35",
            )}
          >
            <span className="label-caps order-2 flex items-center gap-2 pt-1 sm:order-none">
              {ids[0] && (
                <span
                  aria-hidden
                  className="h-3 w-1"
                  style={{ background: colorOf(ids[0]) }}
                />
              )}
              {f.category}
            </span>
            <div>
              <h3 className="text-xl leading-snug font-extrabold">
                {f.headline}
              </h3>
              {f.body && (
                <p className="mt-1 text-sm text-muted-foreground">{f.body}</p>
              )}
              <p className="mt-2 text-xs text-muted-foreground">
                Source: {f.source}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
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
      {leader && event.standings.after_round != null && (
        <p className="text-sm text-muted-foreground">
          After round {event.standings.after_round},{" "}
          {drivers.get(leader.driver_id)?.last_name ?? leader.driver_id} leads
          on {leader.points} points.
        </p>
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
          className="border border-foreground px-3 py-1.5 text-xs font-semibold hover:bg-foreground hover:text-background"
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
              r.active && "bg-secondary",
            )}
          >
            <td className="w-7 py-1.5 text-muted-foreground">{r.pos}</td>
            <td className="py-1.5">
              <span
                className="mr-2 inline-block h-3.5 w-1 align-[-2px]"
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
