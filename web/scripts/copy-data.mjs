// Copy a published v1 tree into public/data/v1, where the app fetches it.
//   node scripts/copy-data.mjs              -> docs/examples/v1 (synthetic example round)
//   node scripts/copy-data.mjs <v1 folder>  -> real output, e.g. downloaded from the Volume
// public/data is gitignored: data is never committed, only copied in before dev or build.
import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(process.argv[2] ?? resolve(web, "../docs/examples/v1"));
const target = resolve(web, "public/data/v1");

if (!existsSync(resolve(source, "index.json"))) {
  console.error(`no index.json in ${source}`);
  process.exit(1);
}
rmSync(target, { recursive: true, force: true });
cpSync(source, target, { recursive: true });
console.log(`data: ${source} -> ${target}`);
