import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useRace } from "./context";

export type Align = "left" | "right";
/** Columns shown only from the `sm` breakpoint up (`wide`) or only below it (`narrow`). */
export type Show = "wide" | "narrow";
export const SHOW: Record<Show, string> = {
  wide: "max-sm:hidden",
  narrow: "sm:hidden",
};

/** Plain table whose rows can pin a driver. Cells never wrap. */
export function ResultsTable({
  head,
  children,
}: {
  head: { label: string; align?: Align; show?: Show }[];
  children: ReactNode;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm tnum sm:min-w-[560px]">
        <thead>
          <tr>
            {head.map((h) => (
              <th
                key={h.label}
                className={cn(
                  "label-caps whitespace-nowrap border-b border-border px-2 py-1.5 font-semibold",
                  h.align === "right" ? "text-right" : "text-left",
                  h.show && SHOW[h.show],
                )}
              >
                {h.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function DriverRow({
  driverId,
  children,
}: {
  /** Pinning this driver on click; omit for rows that are not drivers. */
  driverId?: string;
  children: ReactNode;
}) {
  const { highlight, toggleHighlight } = useRace();
  const on = driverId != null && highlight === driverId;
  return (
    <tr
      tabIndex={driverId ? 0 : undefined}
      onClick={driverId ? () => toggleHighlight(driverId) : undefined}
      onKeyDown={
        driverId
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                toggleHighlight(driverId);
              }
            }
          : undefined
      }
      className={cn(
        "transition-opacity duration-150 [&>td]:h-[30px] [&>td]:whitespace-nowrap [&>td]:border-b [&>td]:border-border [&>td]:px-2",
        driverId && "cursor-pointer",
        highlight != null && driverId !== highlight && driverId && "opacity-30",
        on && "bg-foreground/5",
      )}
    >
      {children}
    </tr>
  );
}

export function NameCell({
  color,
  name,
  sub,
}: {
  color: string;
  name: string;
  sub?: string | undefined;
}) {
  return (
    <td>
      <span className="flex items-center">
        <span
          className="mr-1.5 h-3.5 w-[3px] shrink-0 rounded-sm"
          style={{ background: color }}
        />
        <b className="font-semibold">{name}</b>
        {sub && (
          <span className="ml-2 text-[11px] text-muted-foreground max-sm:hidden">
            {sub}
          </span>
        )}
      </span>
    </td>
  );
}
