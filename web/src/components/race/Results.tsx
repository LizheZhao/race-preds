import { useState } from "react";
import type { QualiRow, RaceRow, ResultsDoc } from "@/data/types";
import { cn } from "@/lib/utils";
import { useRace } from "./context";
import { gainClass, gainLabel, lapFmt, placesGained } from "./format";
import { Seg } from "./Seg";
import { DriverRow, NameCell, ResultsTable } from "./ResultsTable";
import { DriversStandings, TeamsStandings } from "./Standings";

type Tab = "race" | "sprint" | "qualifying" | "drivers" | "teams";
const LABEL: Record<Tab, string> = {
  race: "Race",
  sprint: "Sprint",
  qualifying: "Qualifying",
  drivers: "Drivers' standings",
  teams: "Teams' standings",
};

/** Session classifications and the championship, one table at a time. */
export function ResultsView({ doc }: { doc: ResultsDoc }) {
  const { event } = useRace();
  const tabs = (
    [
      doc.race && "race",
      doc.sprint && "sprint",
      doc.qualifying && "qualifying",
      event && "drivers",
      event && "teams",
    ] as (Tab | undefined | null | false | "")[]
  ).filter((t): t is Tab => !!t);
  const [tab, setTab] = useState<Tab>(tabs[0] ?? "race");
  const active = tabs.includes(tab) ? tab : tabs[0];

  return (
    <div>
      <div className="mb-3">
        <Seg
          label="Session"
          value={active ?? "race"}
          onChange={setTab}
          options={tabs.map((t) => ({ key: t, label: LABEL[t] }))}
        />
      </div>
      <div key={active} className="stage-fade">
        {active === "race" && doc.race && <ClassTable rows={doc.race} />}
        {active === "sprint" && doc.sprint && <ClassTable rows={doc.sprint} />}
        {active === "qualifying" && doc.qualifying && (
          <QualiTable rows={doc.qualifying} />
        )}
        {active === "drivers" && event && <DriversStandings event={event} />}
        {active === "teams" && event && <TeamsStandings event={event} />}
      </div>
    </div>
  );
}

function ClassTable({ rows }: { rows: RaceRow[] }) {
  const { drivers, teamOf, colorOf } = useRace();
  const sorted = [...rows].sort(
    (a, b) => (a.position ?? Infinity) - (b.position ?? Infinity),
  );
  const muted = "text-right text-muted-foreground";
  return (
    <ResultsTable
      head={[
        { label: "Pos" },
        { label: "Driver" },
        ...["Grid", "+/−", "Laps", "Status", "Pts"].map((label) => ({
          label,
          align: "right" as const,
        })),
      ]}
    >
      {sorted.map((r) => {
        const g = placesGained(r.grid ?? null, r.position ?? null);
        return (
          <DriverRow key={r.driver_id} driverId={r.driver_id}>
            <td className="w-10 text-muted-foreground">
              {r.position ?? r.classified_as}
            </td>
            <NameCell
              color={colorOf(r.driver_id)}
              name={drivers.get(r.driver_id)?.last_name ?? r.driver_id}
              sub={teamOf(r.driver_id)?.name}
            />
            <td className={muted}>{r.grid != null ? `P${r.grid}` : "Pit"}</td>
            <td className={cn("text-right", gainClass(g))}>{gainLabel(g)}</td>
            <td className={muted}>{r.laps}</td>
            <td className={cn(muted, "text-xs")}>{r.status}</td>
            <td className="text-right">{r.points || ""}</td>
          </DriverRow>
        );
      })}
    </ResultsTable>
  );
}

function QualiTable({ rows }: { rows: QualiRow[] }) {
  const { drivers, teamOf, colorOf } = useRace();
  const sorted = [...rows].sort((a, b) => a.position - b.position);
  const best = (r: QualiRow) => r.q3_s ?? r.q2_s ?? r.q1_s ?? null;
  const pole = sorted[0] ? best(sorted[0]) : null;
  const muted = "text-right text-muted-foreground";
  return (
    <ResultsTable
      head={[
        { label: "Pos" },
        { label: "Driver" },
        ...["Q1", "Q2", "Q3", "Gap"].map((label) => ({
          label,
          align: "right" as const,
        })),
      ]}
    >
      {sorted.map((r) => {
        const b = best(r);
        return (
          <DriverRow key={r.driver_id} driverId={r.driver_id}>
            <td className="w-10 text-muted-foreground">{r.position}</td>
            <NameCell
              color={colorOf(r.driver_id)}
              name={drivers.get(r.driver_id)?.last_name ?? r.driver_id}
              sub={teamOf(r.driver_id)?.name}
            />
            <td className={muted}>{lapFmt(r.q1_s)}</td>
            <td className={muted}>{lapFmt(r.q2_s)}</td>
            <td className="text-right">{lapFmt(r.q3_s)}</td>
            <td className={muted}>
              {r.position === 1
                ? "pole"
                : b != null && pole != null
                  ? `+${(b - pole).toFixed(3)}`
                  : "—"}
            </td>
          </DriverRow>
        );
      })}
    </ResultsTable>
  );
}
