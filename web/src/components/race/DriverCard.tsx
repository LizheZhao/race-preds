import type { ReactNode } from "react";
import type { FinishingOrderDoc, ResultsDoc } from "@/data/types";
import { OUT_LABEL } from "./compare";
import { INITIAL, tyreFill } from "./Strategy";
import { pct, useRace } from "./context";
import { lapFmt, medianPosition, plural, teamAbbr } from "./format";
import { useTip } from "./Tip";

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-4">
      <h3 className="label-caps mb-1.5">{title}</h3>
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 text-xs tnum [&_dd]:text-right [&_dd]:font-semibold [&_dt]:text-muted-foreground">
        {children}
      </dl>
    </section>
  );
}

/** The pinned driver, or the race winner (the favourite before the race) when nobody is pinned. */
export function DriverCard({
  doc,
  results,
  stageLabel,
}: {
  doc: FinishingOrderDoc;
  results?: ResultsDoc | undefined;
  stageLabel: string;
}) {
  const { event, drivers, teamOf, highlight } = useRace();
  const tip = useTip();
  const winner = results?.race?.find((r) => r.position === 1)?.driver_id;
  const favourite = [...doc.drivers].sort((a, b) => b.p_win - a.p_win)[0]
    ?.driver_id;
  const id = highlight ?? winner ?? favourite;
  const d = id ? drivers.get(id) : undefined;
  const team = id ? teamOf(id) : undefined;
  if (!id || !d || !team) return null;

  const title = highlight
    ? "Pinned driver"
    : winner
      ? "Race winner · click to check any driver"
      : "Favourite · click to check any driver";
  const pred = doc.drivers.find((x) => x.driver_id === id);
  const q = results?.qualifying?.find((x) => x.driver_id === id);
  const sprint = results?.sprint?.find((x) => x.driver_id === id);
  const race = results?.race?.find((x) => x.driver_id === id);
  const standing = event?.standings.drivers.find((x) => x.driver_id === id);
  const teamStanding = event?.standings.teams.find(
    (x) => x.team_id === team.id,
  );
  const stints =
    results?.race_strategies?.find((x) => x.driver_id === id)?.stints ?? [];
  const weekend = q || sprint || race;
  const finish = (r: typeof race) =>
    r?.position != null
      ? `P${r.position}`
      : (OUT_LABEL[r?.classified_as ?? ""] ?? "—");

  return (
    <aside
      aria-live="polite"
      className="border-t border-border pt-4 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0"
    >
      {tip.node}
      <p className="label-caps flex h-6 items-end pb-1">{title}</p>
      <div className="mt-2 flex items-center gap-3">
        <div
          aria-hidden="true"
          className="grid size-11 shrink-0 place-items-center rounded-md font-display text-[13px] font-bold text-white"
          style={{ background: team.color }}
        >
          {teamAbbr(team.id, team.name)}
        </div>
        <div className="min-w-0">
          <p className="font-display text-[22px] font-bold leading-tight">
            {d.first_name} {d.last_name}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">
            #{d.number} · {team.name}
          </p>
        </div>
      </div>

      {weekend && (
        <Group title="This weekend">
          {q && (
            <>
              <dt>Qualifying</dt>
              <dd>
                P{q.position}{" "}
                <span className="font-normal text-muted-foreground">
                  {lapFmt(q.q3_s ?? q.q2_s ?? q.q1_s)}
                </span>
              </dd>
            </>
          )}
          {sprint && (
            <>
              <dt>Sprint</dt>
              <dd>{finish(sprint)}</dd>
            </>
          )}
          {race && (
            <>
              <dt>Race grid → result</dt>
              <dd>
                {race.grid != null ? `P${race.grid}` : "Pit"} →{" "}
                <span className="text-result">{finish(race)}</span>
              </dd>
              <dt>Points scored</dt>
              <dd>{(race.points ?? 0) + (sprint?.points ?? 0)}</dd>
            </>
          )}
        </Group>
      )}

      {pred && (
        <Group title={`Model, after ${stageLabel}`}>
          <dt>Likely finish</dt>
          <dd>P{medianPosition(pred.position_probs)}</dd>
          <dt>Win · Podium · Points</dt>
          <dd>
            {pct(pred.p_win, 0)} · {pct(pred.p_podium, 0)} ·{" "}
            {pct(pred.p_points, 0)}
          </dd>
          <dt>DNF</dt>
          <dd>{pct(pred.p_dnf, 0)}</dd>
        </Group>
      )}

      {stints.length > 0 && (
        <section className="mt-4">
          <h3 className="label-caps mb-1.5">Race tyres</h3>
          <div className="flex h-2.5 gap-px overflow-hidden">
            {stints.map((s, i) => (
              <span
                key={i}
                style={{
                  flex: s.end_lap - s.start_lap + 1,
                  ...tyreFill(s.compound),
                }}
                onPointerEnter={tip.show(
                  <>
                    {s.compound} · laps {s.start_lap}–{s.end_lap}
                  </>,
                )}
                onPointerLeave={tip.hide}
              />
            ))}
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {stints.length - 1}-stop ·{" "}
            {stints.map((s) => INITIAL[s.compound]).join("–")}
          </p>
        </section>
      )}

      {event && (
        <Group title={`Championship · after R${event.standings.after_round}`}>
          <dt>Driver</dt>
          <dd>
            {standing
              ? `P${standing.position} · ${standing.points} pts · ${plural(standing.wins, "win")}`
              : "—"}
          </dd>
          <dt>{team.name}</dt>
          <dd>
            {teamStanding
              ? `P${teamStanding.position} · ${teamStanding.points} pts`
              : "—"}
          </dd>
        </Group>
      )}
    </aside>
  );
}
