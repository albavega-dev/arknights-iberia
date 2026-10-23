import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => (
    <img
      {...props}
      alt={typeof props.alt === "string" ? props.alt : ""}
      data-testid="next-image"
      data-unoptimized={props.unoptimized === true ? "true" : "false"}
    />
  ),
}));

import { OperatorDetailData } from "../../src/app/operators/[slug]/operator-detail-data";
import { OperatorTacticalInfo } from "../../src/app/operators/[slug]/operator-tactical-info";
import type { OperatorRecord } from "../../src/game-data/operators";

const operator: OperatorRecord = {
  id: "char_component_test",
  name: "Component Test",
  cnName: null,
  globalName: null,
  class: "Medic",
  subClassId: "healer",
  rarity: 5,
  slug: "component-test",
  cnOnly: false,
  availabilityStatus: "global-snapshot",
  cnReleaseDate: null,
  globalReleaseDate: null,
  mainPowerNationId: null,
  mainPowerGroupId: null,
  mainPowerTeamId: null,
  mainFactionId: null,
};

const tacticalPhasesFixture = {
  id: "phase-fixture",
  source: null,
  position: "RANGED",
  tags: [],
  phases: [
    { phase: 0, rangeId: "3-6", rangeKey: "en:3-6" },
    { phase: 1, rangeId: "3-1", rangeKey: "en:3-1" },
    { phase: 2, rangeId: "3-1", rangeKey: "en:3-1" },
  ],
} as const;

describe("OperatorDetailData image policy", () => {
  it("marks subclass icons unoptimized and keeps regular icons optimized", () => {
    render(
      <OperatorDetailData
        operator={operator}
        biography={{ status: "not-found", operatorId: operator.id, region: "en", revision: "test" }}
        tactical={null}
        artistCredit={null}
      />,
    );

    const images = screen.getAllByTestId("next-image");
    expect(images).toHaveLength(2);
    expect(images.filter((image) => image.getAttribute("data-unoptimized") === "true")).toHaveLength(1);
    expect(images.filter((image) => image.getAttribute("data-unoptimized") === "false")).toHaveLength(1);
  });

  it("shows a loading state while the E2 illustration transitions", () => {
    const operatorWithIllustrations: OperatorRecord = {
      ...operator,
      id: "char_002_amiya",
      class: "Caster",
      subClassId: null,
    };

    render(
      <OperatorDetailData
        operator={operatorWithIllustrations}
        biography={{ status: "not-found", operatorId: operatorWithIllustrations.id, region: "en", revision: "test" }}
        tactical={null}
        artistCredit={null}
      />,
    );

    expect(document.querySelector(".operator-detail-illustration")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "E2" }));

    const loadingArt = document.querySelector(".operator-detail-art");
    expect(loadingArt).toHaveAttribute("aria-busy", "true");
    const preload = document.querySelector(".operator-detail-illustration-preload");
    expect(preload).toBeInTheDocument();

    fireEvent.load(preload!);

    const eliteTwo = document.querySelector(".operator-detail-illustration.is-elite2");
    expect(eliteTwo).toBeInTheDocument();
    expect(loadingArt).toHaveAttribute("aria-busy", "true");

    fireEvent.load(eliteTwo!);
    expect(document.querySelector(".operator-detail-illustration.is-elite2")).toBeInTheDocument();
  });

  it("renders the tactical tags heading and supplied tags", () => {
    render(
      <OperatorTacticalInfo
        entry={{
          id: "char_002_amiya",
          source: { region: "en", revision: "test" },
          position: "RANGED",
          tags: ["DPS"],
          phases: [
            { phase: 0, rangeId: "3-6", rangeKey: "en:3-6" },
            { phase: 1, rangeId: "3-1", rangeKey: "en:3-1" },
            { phase: 2, rangeId: "3-1", rangeKey: "en:3-1" },
          ],
        }}
      />,
    );

    expect(screen.getByText("Etiquetas")).toBeInTheDocument();
    expect(screen.getByText("DPS")).toBeInTheDocument();
  });

  it("renders no tactical section when the entry is absent or has no valid range", () => {
    const { container, rerender } = render(<OperatorTacticalInfo entry={null} />);
    expect(container).toBeEmptyDOMElement();

    rerender(
      <OperatorTacticalInfo entry={{ id: "empty-range", source: null, position: null, tags: [], phases: [] }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("uses the fallback position label and omits the tags block when tags are absent", () => {
    render(
      <OperatorTacticalInfo
        entry={{
          id: "char_002_amiya",
          source: null,
          position: "UNKNOWN",
          tags: [],
          phases: [{ phase: 0, rangeId: "3-6", rangeKey: "en:3-6" }],
        }}
      />,
    );

    expect(screen.getByText("UNKNOWN")).toBeInTheDocument();
    expect(screen.queryByText("Etiquetas")).not.toBeInTheDocument();
  });

  it("groups equal phase ranges and changes the visible range when selected", () => {
    render(<OperatorTacticalInfo entry={tacticalPhasesFixture} />);

    const phaseSelector = screen.getByRole("group", { name: /Fase de promoción y módulos/i });
    const phaseButtons = screen.getAllByRole("button").filter((button) => phaseSelector.contains(button));
    expect(phaseButtons).toHaveLength(2);
    expect(phaseButtons[0]).toHaveAttribute("aria-pressed", "true");

    const initialReachableCells = screen.getAllByLabelText("Casilla alcanzable").length;
    fireEvent.click(phaseButtons[1]);

    expect(phaseButtons[0]).toHaveAttribute("aria-pressed", "false");
    expect(phaseButtons[1]).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByLabelText("Casilla alcanzable").length).not.toBe(initialReachableCells);
  });

  it("selects the confirmed SPC-X module and changes its active range", () => {
    render(
      <OperatorTacticalInfo
        entry={{
          id: "char_2015_dusk",
          source: null,
          position: "RANGED",
          tags: [],
          phases: [
            { phase: 0, rangeId: "2-3", rangeKey: "en:2-3" },
            { phase: 1, rangeId: "3-6", rangeKey: "en:3-6" },
            { phase: 2, rangeId: "3-6", rangeKey: "en:3-6" },
          ],
        }}
      />,
    );

    const moduleButton = screen.getByRole("button", { name: /SPC-X/ });
    const phaseButton = screen.getAllByRole("button").find((button) => button !== moduleButton)!;
    expect(moduleButton).toHaveAttribute("aria-pressed", "false");
    expect(phaseButton).toHaveAttribute("aria-pressed", "true");

    const phaseReachableCells = screen.getAllByLabelText("Casilla alcanzable").length;
    fireEvent.click(moduleButton);

    expect(moduleButton).toHaveAttribute("aria-pressed", "true");
    expect(phaseButton).toHaveAttribute("aria-pressed", "false");
    expect(screen.getAllByLabelText("Casilla alcanzable").length).not.toBe(phaseReachableCells);
  });

  it("switches between Tactical Anchor Point associated states", () => {
    render(
      <OperatorTacticalInfo
        entry={{
          id: "char_1052_kalts2",
          source: null,
          position: "RANGED",
          tags: [],
          phases: [{ phase: 0, rangeId: "y-2", rangeKey: "en:y-2" }],
        }}
      />,
    );

    const stateSelector = screen.getByRole("group", { name: "Estados de Tactical Anchor Point" });
    const stateButtons = screen.getAllByRole("button").filter((button) => stateSelector.contains(button));
    expect(stateButtons).toHaveLength(2);
    expect(stateButtons[0]).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/Estado y-2/)).toBeInTheDocument();

    fireEvent.click(stateButtons[1]);

    expect(stateButtons[0]).toHaveAttribute("aria-pressed", "false");
    expect(stateButtons[1]).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/Estado y-6/)).toBeInTheDocument();
  });
});
