import { cn } from "@/lib/utils";

/** Segmented control: one button per option, the active one filled. Phones get `short` labels and the full width. */
export function Seg<K extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { key: K; label: string; short?: string; disabled?: boolean }[];
  value: K;
  onChange: (k: K) => void;
  label: string;
}) {
  return (
    <div
      className="flex w-full max-w-full overflow-x-auto border border-foreground sm:inline-flex sm:w-auto"
      role="group"
      aria-label={label}
    >
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          disabled={o.disabled}
          aria-pressed={o.key === value}
          aria-label={o.short ? o.label : undefined}
          onClick={() => onChange(o.key)}
          className={cn(
            "cond flex-1 whitespace-nowrap px-2 py-1.5 text-sm font-bold tracking-[0.06em] uppercase transition-colors disabled:opacity-30 sm:flex-none sm:px-3",
            o.key === value
              ? "bg-foreground text-background"
              : "hover:bg-foreground/8",
          )}
        >
          {o.short ? (
            <>
              <span className="sm:hidden">{o.short}</span>
              <span className="hidden sm:inline">{o.label}</span>
            </>
          ) : (
            o.label
          )}
        </button>
      ))}
    </div>
  );
}
