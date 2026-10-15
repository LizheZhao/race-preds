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
      className="inline-flex max-w-full overflow-x-auto rounded-[4px] border border-border p-0.5"
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
            "whitespace-nowrap rounded-[3px] px-3 py-1.5 font-display text-[11px] font-semibold uppercase tracking-[0.08em] transition-colors disabled:opacity-30",
            o.key === value
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
