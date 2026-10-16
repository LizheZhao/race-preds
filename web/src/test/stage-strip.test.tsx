import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { StageStrip } from "@/components/race/StageStrip";
import { stageTiles } from "@/components/race/stages";
import type { EventDoc, Stage } from "@/data/types";

const section = (stage: Stage, history: Stage[]) => ({ stage, history });

const sessions = ["FP1", "SQ", "S", "Q", "R"].map((id, i) => ({
  id,
  start_utc: `2026-10-0${i + 1}T10:00:00Z`,
})) as unknown as EventDoc["sessions"];

describe("stageTiles", () => {
  const made = section("Q", ["pre_weekend", "FP1", "S"]);

  it("opens the snapshots that exist, marks a stage that ran without one, and opens the race on the last", () => {
    const tiles = stageTiles("sprint_qualifying", "R", made);
    expect(tiles.map((t) => [t.stage, t.state])).toEqual([
      ["pre_weekend", "snapshot"],
      ["FP1", "snapshot"],
      ["SQ", "no_data"],
      ["S", "snapshot"],
      ["Q", "snapshot"],
      ["R", "snapshot"],
    ]);
  });

  it("leaves the stages the weekend has not reached upcoming", () => {
    const tiles = stageTiles(
      "sprint_qualifying",
      "S",
      section("S", ["pre_weekend", "FP1"]),
    );
    expect(tiles.map((t) => t.state)).toEqual([
      "snapshot",
      "snapshot",
      "no_data",
      "snapshot",
      "upcoming",
      "upcoming",
    ]);
  });

  it("offers nothing to open without a section", () => {
    const tiles = stageTiles("conventional", "FP2", undefined);
    expect(tiles.map((t) => t.state)).toEqual([
      "no_data",
      "no_data",
      "no_data",
      "upcoming",
      "upcoming",
      "upcoming",
    ]);
  });
});

describe("StageStrip", () => {
  const tiles = stageTiles(
    "sprint_qualifying",
    "R",
    section("Q", ["pre_weekend", "FP1", "S"]),
  );

  it("selects a snapshot tile, and cannot select a stage with no data", () => {
    const onSelect = vi.fn();
    render(
      <StageStrip
        tiles={tiles}
        selected="R"
        current="R"
        sessions={sessions}
        onSelect={onSelect}
      />,
    );

    const sprintQ = screen.getByRole("button", { name: /Sprint Q/ });
    expect(sprintQ).toBeDisabled();
    expect(sprintQ).toHaveTextContent("No data");

    fireEvent.click(screen.getByRole("button", { name: /FP1/ }));
    expect(onSelect).toHaveBeenCalledWith("FP1");
  });

  it("marks the selected stage and tags the race Final once it has run", () => {
    render(
      <StageStrip
        tiles={tiles}
        selected="R"
        current="R"
        sessions={sessions}
        onSelect={() => {}}
      />,
    );
    const race = screen.getByRole("button", { name: /Race/ });
    expect(race).toHaveAttribute("aria-current", "step");
    expect(race).toHaveTextContent("Final");
    expect(screen.getByRole("button", { name: /FP1/ })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("tags the current stage Now before the race and disables the stages ahead", () => {
    render(
      <StageStrip
        tiles={stageTiles(
          "sprint_qualifying",
          "Q",
          section("Q", ["pre_weekend", "FP1", "S"]),
        )}
        selected="Q"
        current="Q"
        sessions={sessions}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /Quali/ })).toHaveTextContent(
      "Now",
    );
    expect(screen.getByRole("button", { name: /Race/ })).toBeDisabled();
  });
});
