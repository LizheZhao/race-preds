// Generate src/data/generated/*.ts from docs/schema/*.schema.json (exported from src/schema.py).
// Run after `python -m src.schema export docs/schema`; commit the result.
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "json-schema-to-typescript";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const schemaDir = resolve(web, "../docs/schema");
const outDir = resolve(web, "src/data/generated");

// pydantic writes tuples as JSON Schema 2020-12 `prefixItems`, which json-schema-to-typescript
// doesn't read (it types them as unknown). Rewrite them to the draft-07 tuple form it does read.
function draft07Tuples(node) {
  if (Array.isArray(node)) return node.map(draft07Tuples);
  if (node === null || typeof node !== "object") return node;
  const out = Object.fromEntries(
    Object.entries(node).map(([k, v]) => [k, draft07Tuples(v)]),
  );
  if (out.prefixItems) {
    out.items = out.prefixItems;
    delete out.prefixItems;
  }
  return out;
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
for (const file of readdirSync(schemaDir).filter((f) =>
  f.endsWith(".schema.json"),
)) {
  const schema = draft07Tuples(
    JSON.parse(readFileSync(resolve(schemaDir, file), "utf8")),
  );
  const ts = await compile(schema, schema.title ?? file, {
    additionalProperties: false,
    unreachableDefinitions: true,
    bannerComment: `// Generated from docs/schema/${file} by scripts/gen-types.mjs. Do not edit.`,
  });
  writeFileSync(resolve(outDir, file.replace(".schema.json", ".ts")), ts);
  console.log(`types: ${file}`);
}
