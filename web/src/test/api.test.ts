import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DATA_BASE_URL,
  loadCurrentRound,
  loadStageDoc,
  stagePath,
  withVersion,
} from "@/data/api";

// Serve docs/examples/v1 (the schema-valid example round) in place of the network.
const EXAMPLES = resolve(__dirname, "../../../docs/examples/v1");

function serveExamples() {
  const requested: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      requested.push(url);
      const path = url.slice(DATA_BASE_URL.length).split("?")[0]!;
      try {
        const body = readFileSync(EXAMPLES + path, "utf8");
        return new Response(body, { status: 200 });
      } catch {
        return new Response("", { status: 404, statusText: "Not Found" });
      }
    }),
  );
  return requested;
}

afterEach(() => vi.unstubAllGlobals());

describe("data paths", () => {
  it("puts a stage snapshot next to the current document", () => {
    expect(stagePath("finishing_order/FP2.json", "FP1")).toBe(
      "finishing_order/FP1.json",
    );
  });

  it("only adds a version query when there is a version", () => {
    expect(withVersion("a.json", null)).toBe("a.json");
    expect(withVersion("a.json", "2025-09-05T14:00:00Z")).toBe(
      "a.json?v=2025-09-05T14%3A00%3A00Z",
    );
  });
});

describe("loadCurrentRound", () => {
  it("loads the example round with cache-busting queries on every rewritten file", async () => {
    const requested = serveExamples();
    const bundle = await loadCurrentRound();

    expect(bundle.manifest.meta.round).toBe(16);
    expect(bundle.fetchErrors).toEqual({});
    expect(bundle.docs.finishing_order?.drivers.length).toBeGreaterThan(0);
    // index and manifest change every publish, sections carry their updated_at
    for (const url of requested) expect(url).toMatch(/\?v=/);
  });

  it("loads an earlier stage from the manifest history and nothing that isn't listed", async () => {
    serveExamples();
    const bundle = await loadCurrentRound();

    const fp1 = await loadStageDoc(bundle, "finishing_order", "FP1");
    expect(fp1?.meta.stage).toBe("FP1");
    expect(await loadStageDoc(bundle, "finishing_order", "Q")).toBeUndefined();
  });
});
