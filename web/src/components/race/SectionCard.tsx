import type { ReactNode } from "react";
import { AlertTriangle, Info } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { ModelInfo, SectionStatus } from "@/data/types";
import { cn } from "@/lib/utils";

interface Props {
  id?: string;
  title: string;
  subtitle?: ReactNode;
  emptyText?: string | undefined;
  section?: SectionStatus | undefined;
  fetchError?: string | undefined;
  hasData: boolean;
  model?: ModelInfo | undefined;
  className?: string;
  aside?: ReactNode;
  stageKey?: string;
  children?: ReactNode;
}

export function SectionCard({
  id,
  title,
  subtitle,
  emptyText,
  section,
  fetchError,
  hasData,
  model,
  className,
  aside,
  stageKey,
  children,
}: Props) {
  const status = section?.status ?? "error";
  if (status === "not_applicable") return null;

  let body: ReactNode;
  if (status === "pending") {
    body = (
      <div className="flex min-h-32 items-center justify-center text-sm text-muted-foreground">
        Available after {section?.available_from ?? "a later session"}
      </div>
    );
  } else if (status === "error" || fetchError) {
    body = (
      <div className="flex min-h-32 items-center justify-center text-center text-sm text-muted-foreground">
        {section?.message ?? fetchError ?? "This section could not be loaded."}
      </div>
    );
  } else if (!hasData) {
    body = (
      <div className="flex min-h-32 items-center justify-center text-sm text-muted-foreground">
        {emptyText ?? "No snapshot for this stage."}
      </div>
    );
  } else {
    body = (
      <div key={stageKey} className="stage-fade">
        {children}
      </div>
    );
  }

  return (
    <section
      id={id}
      className={cn(
        "flex min-w-0 scroll-mt-32 flex-col rounded-md border border-border bg-card p-4 md:px-6 md:py-5",
        className,
      )}
    >
      <header className="mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="section-title">{title}</h2>
            {model && !model.calibrated && hasData && status !== "pending" && (
              <UncalibratedNote />
            )}
          </div>
          {subtitle && (
            <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
          )}
        </div>
        {aside}
      </header>
      {status === "stale" && (
        <div className="mb-4 flex items-start gap-2 rounded-sm border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          <AlertTriangle className="mt-px size-3.5 shrink-0" />
          <span>
            {section?.message ??
              "Showing the last good data; the latest refresh failed."}
          </span>
        </div>
      )}
      <div className="min-w-0 flex-1">{body}</div>
      {model && hasData && (status === "ready" || status === "stale") && (
        <ModelFooter model={model} />
      )}
    </section>
  );
}

function UncalibratedNote() {
  return (
    <Popover>
      <PopoverTrigger
        aria-label="About these scores"
        className="text-muted-foreground hover:text-foreground"
      >
        <Info className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent className="w-64 text-xs">
        These are relative model scores, not calibrated probabilities.
      </PopoverContent>
    </Popover>
  );
}

function ModelFooter({ model }: { model: ModelInfo }) {
  return (
    <footer className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-3 text-[11px] text-muted-foreground">
      <Popover>
        <PopoverTrigger className="underline decoration-dotted underline-offset-2 hover:text-foreground">
          {model.name} v{model.version}
        </PopoverTrigger>
        <PopoverContent className="w-80 text-xs">
          <p className="label-caps mb-2">Backtest</p>
          {(model.backtest ?? []).length === 0 && (
            <p className="text-muted-foreground">No backtest published.</p>
          )}
          <ul className="space-y-2">
            {(model.backtest ?? []).map((m) => {
              const better =
                m.baseline_value == null
                  ? null
                  : m.lower_is_better
                    ? m.value < m.baseline_value
                    : m.value > m.baseline_value;
              return (
                <li key={m.name}>
                  <div className="flex justify-between gap-2">
                    <span>{m.name}</span>
                    <span
                      className={cn(
                        "tnum font-semibold",
                        better === true && "text-foreground",
                        better === false && "text-primary",
                      )}
                    >
                      {m.value}
                    </span>
                  </div>
                  {m.baseline_name && (
                    <div className="flex justify-between gap-2 text-muted-foreground">
                      <span>vs {m.baseline_name}</span>
                      <span className="tnum">{m.baseline_value}</span>
                    </div>
                  )}
                  <div className="text-muted-foreground">
                    {m.evaluated_on} ·{" "}
                    {m.lower_is_better ? "lower is better" : "higher is better"}
                  </div>
                </li>
              );
            })}
          </ul>
        </PopoverContent>
      </Popover>
      <span>trained through {model.trained_through}</span>
    </footer>
  );
}
