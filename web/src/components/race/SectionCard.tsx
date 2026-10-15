import type { ReactNode } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { ModelInfo, SectionStatus } from "@/data/types";
import { cn } from "@/lib/utils";

interface Props {
  title: string;
  section?: SectionStatus | undefined;
  fetchError?: string | undefined;
  hasData: boolean;
  model?: ModelInfo | undefined;
  /** Prediction sections carry the full apparatus: card, ink rule, model footer. */
  prediction?: boolean;
  className?: string;
  aside?: ReactNode;
  stageKey?: string;
  children?: ReactNode;
}

export function SectionCard({
  title,
  section,
  fetchError,
  hasData,
  model,
  prediction,
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
      <Empty stamp="Pending" tone="muted">
        Opens after {section?.available_from ?? "a later session"}.
      </Empty>
    );
  } else if (status === "error" || fetchError) {
    body = (
      <Empty stamp="Void" tone="red">
        {section?.message ?? fetchError ?? "This section could not be loaded."}
      </Empty>
    );
  } else if (!hasData) {
    body = (
      <Empty stamp="No snapshot" tone="muted">
        Nothing was published for this stage.
      </Empty>
    );
  } else {
    body = (
      <div key={stageKey} className="stage-fade">
        {children}
      </div>
    );
  }

  const showModel =
    model && hasData && (status === "ready" || status === "stale");

  return (
    <section
      aria-label={title}
      className={cn(
        "flex min-w-0 flex-col",
        prediction
          ? "border border-border border-t-foreground border-t-[3px] bg-card"
          : "border-t-[3px] border-foreground pt-1",
        className,
      )}
    >
      <header
        className={cn(
          "flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3",
          prediction && "border-b border-border px-5 md:px-6",
        )}
      >
        <div className="flex items-center gap-3">
          <h2 className="text-lg leading-none font-extrabold tracking-[0.05em] uppercase">
            {title}
          </h2>
          {status === "stale" && (
            <span className="stamp text-[11px] text-warning">Stale</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {aside}
          {model && !model.calibrated && hasData && status !== "pending" && (
            <UncalibratedNote />
          )}
        </div>
      </header>
      {status === "stale" && (
        <p
          className={cn(
            "mt-4 border border-flag-yellow bg-flag-yellow/20 px-3 py-2 text-xs text-foreground",
            prediction && "mx-5 md:mx-6",
          )}
        >
          {section?.message ??
            "Showing the last good data; the latest refresh failed."}
        </p>
      )}
      <div
        className={cn(
          "min-w-0 flex-1 pt-5",
          prediction ? "px-5 pb-5 md:px-6 md:pb-6" : "pb-2",
        )}
      >
        {body}
      </div>
      {showModel && <ModelFooter model={model} />}
    </section>
  );
}

function Empty({
  stamp,
  tone,
  children,
}: {
  stamp: string;
  tone: "muted" | "red";
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-36 flex-col items-center justify-center gap-3 text-center">
      <span
        className={cn(
          "stamp text-base",
          tone === "red" ? "text-flag-red" : "text-subtle",
        )}
      >
        {stamp}
      </span>
      <p className="max-w-sm text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

function UncalibratedNote() {
  return (
    <Popover>
      <PopoverTrigger className="border border-border px-1.5 py-0.5 text-[11px] font-semibold tracking-[0.04em] text-muted-foreground uppercase hover:border-foreground hover:text-foreground">
        Model scores
      </PopoverTrigger>
      <PopoverContent className="w-64 text-xs">
        This model is not calibrated yet, so its numbers are relative model
        scores, not probabilities. Read them as a ranking, not as odds.
      </PopoverContent>
    </Popover>
  );
}

function ModelFooter({ model }: { model: ModelInfo }) {
  const backtest = model.backtest ?? [];
  return (
    <footer className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border bg-background/60 px-5 py-2.5 text-xs text-muted-foreground md:px-6">
      <span>
        Model{" "}
        <span className="font-semibold text-foreground">
          {model.name} {model.version}
        </span>
      </span>
      <span className="tnum">Trained through {model.trained_through}</span>
      <Popover>
        <PopoverTrigger className="ml-auto font-semibold text-foreground underline decoration-border hover:decoration-foreground">
          {backtest.length ? `Backtest (${backtest.length})` : "Backtest"}
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 text-xs">
          <p className="label-caps mb-2">Backtest</p>
          {backtest.length === 0 && (
            <p className="text-muted-foreground">
              No backtest published for this model yet.
            </p>
          )}
          <ul className="space-y-2">
            {backtest.map((m) => {
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
                        "font-semibold tnum",
                        better === true && "text-gain",
                        better === false && "text-flag-red",
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
    </footer>
  );
}
