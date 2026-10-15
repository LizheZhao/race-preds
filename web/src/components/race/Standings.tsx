import type { EventDoc } from "@/data/types";
import { useRace } from "./context";
import { teamAbbr } from "./format";
import { DriverRow, NameCell, ResultsTable } from "./ResultsTable";

const gap = (leader: number, pts: number, pos: number) =>
  pos === 1 ? "leader" : `−${leader - pts}`;

function Caption({ event }: { event: EventDoc }) {
  return (
    <p className="mb-2 text-xs text-muted-foreground">
      After round {event.standings.after_round}
    </p>
  );
}

const HEAD = (first: string) => [
  { label: "Pos" },
  { label: first },
  ...["Pts", "Wins", "Gap"].map((label) => ({
    label,
    align: "right" as const,
  })),
];

export function DriversStandings({ event }: { event: EventDoc }) {
  const { drivers, teamOf, colorOf } = useRace();
  const rows = [...event.standings.drivers].sort(
    (a, b) => a.position - b.position,
  );
  const leader = rows[0]?.points ?? 0;
  return (
    <>
      <Caption event={event} />
      <ResultsTable head={HEAD("Driver")}>
        {rows.map((r) => {
          const d = drivers.get(r.driver_id);
          return (
            <DriverRow key={r.driver_id} driverId={r.driver_id}>
              <td className="w-10 text-muted-foreground">{r.position}</td>
              <NameCell
                color={colorOf(r.driver_id)}
                name={d ? `${d.first_name} ${d.last_name}` : r.driver_id}
                sub={teamOf(r.driver_id)?.name}
              />
              <td className="text-right">{r.points}</td>
              <td className="text-right text-muted-foreground">{r.wins}</td>
              <td className="text-right text-muted-foreground">
                {gap(leader, r.points, r.position)}
              </td>
            </DriverRow>
          );
        })}
      </ResultsTable>
    </>
  );
}

export function TeamsStandings({ event }: { event: EventDoc }) {
  const teams = new Map(event.teams.map((t) => [t.id, t]));
  const rows = [...event.standings.teams].sort(
    (a, b) => a.position - b.position,
  );
  const leader = rows[0]?.points ?? 0;
  return (
    <>
      <Caption event={event} />
      <ResultsTable head={HEAD("Team")}>
        {rows.map((r) => {
          const t = teams.get(r.team_id);
          const codes = event.drivers
            .filter((d) => d.team_id === r.team_id)
            .map((d) => d.code)
            .join(" · ");
          return (
            <DriverRow key={r.team_id}>
              <td className="w-10 text-muted-foreground">{r.position}</td>
              <td>
                <span className="flex items-center gap-2.5">
                  <span
                    aria-hidden="true"
                    className="grid h-5 w-[30px] place-items-center rounded-[3px] font-display text-[9px] font-bold text-white"
                    style={{ background: t?.color ?? "var(--subtle)" }}
                  >
                    {teamAbbr(r.team_id, t?.name ?? r.team_id)}
                  </span>
                  <b className="font-semibold">{t?.name ?? r.team_id}</b>
                  <span className="text-[11px] text-muted-foreground">
                    {codes}
                  </span>
                </span>
              </td>
              <td className="text-right">{r.points}</td>
              <td className="text-right text-muted-foreground">{r.wins}</td>
              <td className="text-right text-muted-foreground">
                {gap(leader, r.points, r.position)}
              </td>
            </DriverRow>
          );
        })}
      </ResultsTable>
    </>
  );
}
