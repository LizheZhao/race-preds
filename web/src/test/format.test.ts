import { describe, expect, it } from "vitest";
import {
  boxStats,
  gainLabel,
  medianPosition,
  placesGained,
} from "@/components/race/format";

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

describe("boxStats", () => {
  it("summarises laps with Tukey whiskers and flags slow outliers", () => {
    const s = boxStats([90, 91, 92, 93, 94, 120])!;
    expect([s.q1, s.median, s.q3]).toEqual([91.25, 92.5, 93.75]);
    expect([s.low, s.high]).toEqual([90, 94]);
    expect(s.outliers).toEqual([120]);
  });
  it("needs three laps", () => {
    expect(boxStats([90, 91])).toBeNull();
  });
});
