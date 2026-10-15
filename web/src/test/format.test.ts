import { describe, expect, it } from "vitest";
import { sessionColumns } from "@/components/race/compare";
import {
  gainLabel,
  medianPosition,
  placesGained,
} from "@/components/race/format";
import type { ResultsDoc } from "@/data/types";

describe("medianPosition", () => {
  it("is the first position where half the mass is reached", () => {
    expect(medianPosition([0.1, 0.2, 0.4, 0.3])).toBe(3);
    expect(medianPosition([0.5, 0.5, 0, 0])).toBe(1);
  });
});

describe("gain", () => {
  it("is grid minus finish, with an arrow", () => {
    expect(gainLabel(placesGained(10, 8))).toBe("▲2");
    expect(gainLabel(placesGained(3, 5))).toBe("▼2");
    expect(gainLabel(placesGained(null, 5))).toBe("—");
  });
});

describe("sessionColumns", () => {
  it("orders sessions and ends retirements in the race column", () => {
    const row = (
      driver_id: string,
      grid: number | null,
      position: number | null,
    ) => ({
      driver_id,
      grid,
      position,
      classified_as: position == null ? "R" : String(position),
      status: "",
      points: 0,
      laps: 1,
    });
    const cols = sessionColumns({
      sprint: [row("a", 1, 1), row("b", null, 2)],
      race: [row("a", 1, 1), row("b", 2, null)],
    } as unknown as ResultsDoc);
    expect(cols.map((c) => c.label)).toEqual([
      "Sprint Quali",
      "Sprint",
      "Race",
    ]);
    expect(cols[0]!.order).toEqual(["a", "b"]);
    expect([...cols[0]!.out!]).toEqual(["b"]);
    expect(cols[2]!.outLabel!("b")).toBe("DNF");
  });
});
