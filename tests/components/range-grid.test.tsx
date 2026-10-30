import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RangeGrid, getRangeGridEnvelope } from "../../src/app/operators/range-grid";
import rangeData from "../../data/operator-skills/char_002_amiya.json";

// Geometry exactly as stored in data/operator-skills/ (range_table shape: direction + grids).
const cross = { direction: 1, grids: [{ row: 0, col: 1 }, { row: 0, col: 2 }, { row: -1, col: 0 }] };

describe("getRangeGridEnvelope", () => {
  it("always includes the operator cell", () => {
    expect(getRangeGridEnvelope([])).toEqual({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 });
    expect(getRangeGridEnvelope(cross.grids)).toEqual({ minRow: -1, maxRow: 0, minCol: 0, maxCol: 2 });
  });
});

describe("RangeGrid", () => {
  it("draws the operator, reachable and unreachable cells of a range_table geometry", () => {
    const { container } = render(<RangeGrid grids={cross.grids} label="Rango" />);
    expect(screen.getByText("Rango")).toBeInTheDocument();
    expect(screen.getAllByLabelText("Casilla del operador")).toHaveLength(1);
    expect(screen.getAllByLabelText("Casilla alcanzable")).toHaveLength(3);
    expect(screen.getAllByLabelText("Fuera del alcance")).toHaveLength(2);
    expect(container.querySelector(".operator-range-grid")).toHaveStyle({ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" });
  });

  it("draws rows from the highest to the lowest", () => {
    const { container } = render(<RangeGrid grids={[{ row: 1, col: 0 }]} />);
    const cells = [...container.querySelectorAll(".operator-range-cell")];
    expect(cells.map((cell) => cell.className.replace("operator-range-cell", "").trim())).toEqual(["is-reachable", "is-operator"]);
  });

  it("uses a shared envelope when given and omits the heading without a label", () => {
    const { container } = render(<RangeGrid grids={[{ row: 0, col: 1 }]} envelope={{ minRow: -1, maxRow: 1, minCol: -1, maxCol: 2 }} />);
    expect(container.querySelector(".operator-tactical-range-heading")).toBeNull();
    expect(container.querySelectorAll(".operator-range-cell")).toHaveLength(12);
    expect(container.querySelector(".operator-range-grid")).toHaveStyle({ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" });
  });

  it("accepts the ranges stored in the skills dataset as they are", () => {
    const ranges = Object.entries((rangeData as { ranges: Record<string, { direction: number; grids: { row: number; col: number }[] }> }).ranges);
    expect(ranges.length).toBeGreaterThan(0);
    for (const [, range] of ranges) {
      const { container, unmount } = render(<RangeGrid grids={range.grids} />);
      expect(container.querySelectorAll(".is-reachable").length).toBe(new Set(range.grids.filter((cell) => cell.row !== 0 || cell.col !== 0).map((cell) => `${cell.row}:${cell.col}`)).size);
      unmount();
    }
  });
});
