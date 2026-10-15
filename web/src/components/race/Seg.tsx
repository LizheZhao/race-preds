import { cn } from "@/lib/utils";

/** Segmented control: one button per option, the active one filled. */
export function Seg<K extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { key: K; label: string; disabled?: boolean }[];
  value: K;
  onChange: (k: K) => void;
  label: string;
}) {
  return (
    <div
      className="inline-flex max-w-full overflow-x-auto border border-foreground"
      role="group"
      aria-label={label}
    >
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          disabled={o.disabled}
          aria-pressed={o.key === value}
          onClick={() => onChange(o.key)}
          className={cn(
            "cond whitespace-nowrap px-3 py-1.5 text-sm font-bold tracking-[0.06em] uppercase transition-colors disabled:opacity-30",
            o.key === value
              ? "bg-foreground text-background"
              : "hover:bg-foreground/8",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
