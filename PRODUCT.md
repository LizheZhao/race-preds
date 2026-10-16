# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

React 19 SPA in `web/` (Vite, Tailwind v4, shadcn/ui, Recharts, TanStack Query), static, deployed to
GitHub Pages under `/race-preds/`. No application server; the page only reads published JSON.

## Purpose

A live F1 race-weekend dashboard. During a race weekend (Thu–Sun) a scheduled pipeline (Databricks
lakehouse + MLflow models, GitHub Actions dispatcher) publishes predictions after each session:
predicted finishing order, predicted qualifying, tyre strategy, safety car / VSC / red flag risk,
weather, circuit, championship, fun facts, and the actual results once sessions finish.

## Users

Primary: portfolio readers and recruiters, mostly on desktop. They open the public link to judge
the owner's data engineering and modelling work. The page has to make the pipeline's output read as
credible, rigorous and well made within a first look, and reward a closer look.

Secondary: F1 fans checking who is predicted to win and whether a safety car is likely.

## Product truth to preserve

- Every prediction is a snapshot per weekend stage (pre_weekend, FP1…Q, R); the stage timeline lets
  the visitor step back through earlier snapshots. After the race, predictions are compared to the result.
- While `model.calibrated` is false, numbers are "model scores", never "chances" (`probNoun()`).
- Every section handles five manifest statuses: ready, stale, pending, error, not_applicable.
- Each prediction names its model, version, training cut-off and backtest against a baseline.
- 2026 grid: 22 cars, 11 teams; never assume 20.
- Data contract: `src/schema.py` → `docs/schema` → `web/src/data/generated/`. The redesign never
  changes the data layer.

## Voice

Plain, precise, numerate. No hype, no gambling language.
