import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Caption over a large display figure, with an optional note under it. */
export function Stat({
  label,
  value,
  note,
  mark,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  note?: string;
  /** Hit (✓) or miss (✗) beside the value. */
  mark?: boolean | undefined;
  className?: string;
}) {
  return (
    <div>
      <p className="label-caps mb-1.5">{label}</p>
      <p
        className={cn("xcond text-4xl leading-none font-black tnum", className)}
      >
        {value}
        {mark != null && (
          <span
            className={cn("ml-2 text-sm", mark ? "text-gain" : "text-flag-red")}
          >
            {mark ? "✓" : "✗"}
          </span>
        )}
      </p>
      {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}
