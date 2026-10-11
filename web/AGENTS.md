## Architecture

The front end of race-preds: a static React single-page app (Vite, Tailwind, shadcn/ui,
Recharts, TanStack Query). It was designed once in Lovable and is maintained here; there
is no Lovable sync. It is deployed to GitHub Pages at `/race-preds/` together with the
published JSON (see Part 3 of `../docs/pipeline-plan.md`).

- All data fetching lives in `src/data/api.ts`. The base URL is
  `${import.meta.env.BASE_URL}data/v1` unless `VITE_DATA_BASE_URL` overrides it.
- GitHub Pages caches every file for 10 minutes and the headers can't be changed. Files
  rewritten in place get a version query: `index.json` / `manifest.json` a timestamp,
  section documents the manifest's `updated_at`. Stage snapshots never change and get none.
- `src/data/generated/` is generated from `../docs/schema/*.schema.json` by
  `npm run gen:types`. Never edit it by hand. `src/data/types.ts` only gives friendly
  names to the generated types; it never declares document fields.
- `public/data/v1` is gitignored. `npm run data` copies `../docs/examples/v1` there;
  `npm run data -- <folder>` copies real published output.
- Prediction UI says "chance" only when `model.calibrated` is true, otherwise
  "model score". This is enforced via `probNoun()`.
- Every card handles all five manifest statuses through `SectionCard`.
- The base path is `/race-preds/` (`vite.config.ts`). Use `import.meta.env.BASE_URL` for
  any URL, never a root-absolute path.
