import type { QualiRow, RaceRow, ResultsDoc } from "@/data/types";
import { cn } from "@/lib/utils";
import { useRace } from "./context";

/** Actual outcomes: the race once it has run, otherwise the latest classified session. */
export function ResultsView({ doc }: { doc: ResultsDoc }) {
  const incidents = doc.race_incidents;
  return (
    <div className="space-y-5">
      {incidents && (
        <p className="text-sm tnum">
          {incidents.safety_cars} safety car
          {incidents.safety_cars === 1 ? "" : "s"} · {incidents.vscs} VSC ·{" "}
          {incidents.red_flags} red flag{incidents.red_flags === 1 ? "" : "s"}
        </p>
      )}
      <div className="grid gap-6 lg:grid-cols-3">
        {doc.race && <RaceTable title="Race" rows={doc.race} />}
        {doc.sprint && <RaceTable title="Sprint" rows={doc.sprint} />}
        {doc.qualifying && <QualiTable rows={doc.qualifying} />}
      </div>
    </div>
  );
}

function RaceTable({ title, rows }: { title: string; rows: RaceRow[] }) {
  const sorted = [...rows].sort(
    (a, b) => (a.position ?? Infinity) - (b.position ?? Infinity),
  );
  return (
    <Table head={title} cols={["Grid", "Pts"]}>
      {sorted.map((r) => (
        <Row
          key={r.driver_id}
          driverId={r.driver_id}
          pos={r.position != null ? String(r.position) : r.classified_as}
          cells={[
            r.grid != null ? `P${r.grid}` : "Pit",
            r.points ? String(r.points) : "",
          ]}
          note={r.position == null ? r.status : undefined}
        />
      ))}
    </Table>
  );
}

function QualiTable({ rows }: { rows: QualiRow[] }) {
  const sorted = [...rows].sort((a, b) => a.position - b.position);
  const best = (r: QualiRow) => r.q3_s ?? r.q2_s ?? r.q1_s ?? null;
  return (
    <Table head="Qualifying" cols={["Best", ""]}>
      {sorted.map((r) => {
        const t = best(r);
        return (
          <Row
            key={r.driver_id}
            driverId={r.driver_id}
            pos={String(r.position)}
            cells={[
              t != null
                ? `${Math.floor(t / 60)}:${(t % 60).toFixed(3).padStart(6, "0")}`
                : "—",
              "",
            ]}
          />
        );
      })}
    </Table>
  );
}

function Table({
  head,
  cols,
  children,
}: {
  head: string;
  cols: string[];
  children: React.ReactNode;
}) {
  return (
    <table className="w-full text-sm tnum">
      <thead>
        <tr className="label-caps text-left">
          <th className="pb-2 font-semibold" colSpan={2}>
            {head}
          </th>
          {cols.map((c, i) => (
            <th key={i} className="pb-2 text-right font-semibold">
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

function Row({
  driverId,
  pos,
  cells,
  note,
}: {
  driverId: string;
  pos: string;
  cells: string[];
  note?: string | undefined;
}) {
  const { drivers, colorOf, highlight, toggleHighlight } = useRace();
  const d = drivers.get(driverId);
  return (
    <tr
      onClick={() => toggleHighlight(driverId)}
      className={cn(
        "cursor-pointer border-t border-border transition-opacity hover:bg-secondary",
        highlight != null && highlight !== driverId && "opacity-35",
        highlight === driverId && "bg-secondary",
      )}
    >
      <td className="w-8 py-1.5 text-muted-foreground">{pos}</td>
      <td className="py-1.5">
        <span
          className="mr-2 inline-block h-3.5 w-1 align-[-2px]"
          style={{ background: colorOf(driverId) }}
        />
        {d?.last_name ?? driverId}
        {note && (
          <span className="ml-2 text-xs text-muted-foreground">{note}</span>
        )}
      </td>
      {cells.map((c, i) => (
        <td key={i} className="py-1.5 text-right text-muted-foreground">
          {c}
        </td>
      ))}
    </tr>
  );
}
