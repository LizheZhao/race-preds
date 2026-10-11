# Race Week (web)

The static front end of race-preds. It reads the published JSON documents
(`docs/artifact-schema.md`) and has no backend.

```sh
npm ci
npm run dev        # copies docs/examples/v1 into public/data, then serves at /race-preds/
npm test
npm run build      # typecheck + static build into dist/ (served at /race-preds/)
```

- After `src/schema.py` changes: `python -m src.schema export docs/schema` from the repo
  root, then `npm run gen:types` here, and commit `src/data/generated/`.
- To build against real output, run `npm run data -- <published v1 folder>` before
  `npm run build`.
- The base path is set in `vite.config.ts`. Override it with `BASE_PATH=/ npm run build`
  for a host that serves from the root.

See `AGENTS.md` for the conventions.
