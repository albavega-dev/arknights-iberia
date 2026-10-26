import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
import { getRelevantPotentialRanks, officialPotentialToAppliedRanks, type OperatorStatsProfile } from "../../src/game-data/operator-stats";

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

const statsFixture: OperatorStatsProfile = {
  operatorId: operator.id,
  region: "en",
  source: { repository: "test", revision: "test", path: "character_table.json", sha256: "test" },
  phases: [
    { phase: 0, maxLevel: 30, keyframes: [{ level: 1, attributes: { maxHp: 100, atk: 20, def: 10, magicResistance: 0, baseAttackTime: 1.2 } }, { level: 30, attributes: { maxHp: 200, atk: 40, def: 20, magicResistance: 5, baseAttackTime: 1.2 } }] },
    { phase: 1, maxLevel: 50, keyframes: [{ level: 1, attributes: { maxHp: 210, atk: 42, def: 21, magicResistance: 5 } }, { level: 50, attributes: { maxHp: 400, atk: 80, def: 40, magicResistance: 10 } }] },
  ],
  favorKeyframes: [{ level: 100, attributes: { atk: 5 } }],
  potentialRanks: [
    { rank: 0, effects: [{ attributes: { attributeModifiers: [{ attributeType: "ATK", formulaItem: "ADDITION", value: 2 }] } }] },
    { rank: 1, effects: [{ attributes: { attributeModifiers: [{ attributeType: "ATK", formulaItem: "ADDITION", value: 3 }] } }] },
    { rank: 2, effects: [] },
  ],
  modules: [{ uniEquipId: "uniequip_test", operatorId: operator.id, region: "en", name: "Test Module", moduleType: "SPC-X", typeIcon: "spc-x", moduleSourceRegion: "en", levels: [{ level: 1, attributes: { atk: 3 }, specialEffects: [] }] }],
};

describe("OperatorDetailData image policy", () => {
  it("calculates stats through elite, level, trust, potential and module controls", () => {
    render(
      <OperatorDetailData
        operator={operator}
        stats={statsFixture}
        biography={{ status: "not-found", operatorId: operator.id, region: "en", revision: "test" }}
        tactical={null}
        artistCredit={null}
      />,
    );

    expect(screen.queryByRole("button", { name: "Potencial 1" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Potencial 2" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "Potencial 2" }));
    expect(screen.getByRole("button", { name: "Potencial 2" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Potencial 2" }));
    expect(screen.getByRole("button", { name: "Potencial 2" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("heading", { name: /Élite 1 nivel 50/ })).toBeInTheDocument();
    const level = document.getElementById("stats-level") as HTMLInputElement;
    fireEvent.change(level, { target: { value: "25" } });
    expect(screen.getByText("303")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Élite 0" }));
    expect(screen.getByRole("heading", { name: /Élite 0 nivel 1/ })).toBeInTheDocument();
    expect(level).toHaveValue("1");
    fireEvent.change(level, { target: { value: "25" } });
    fireEvent.click(screen.getByRole("button", { name: "Élite 0" }));
    expect(screen.getByRole("heading", { name: /Élite 0 nivel 25/ })).toBeInTheDocument();
    const statsCard = screen.getByRole("region", { name: "Estadísticas calculadas" });
    expect(statsCard).toHaveTextContent("Intervalo");
    expect(statsCard).not.toHaveTextContent("Velocidad de ataque");
    const withoutModule = statsCard.textContent;
    const moduleButton = screen.getByRole("button", { name: /SPC-X: Test Module/ });
    expect(moduleButton).toHaveAttribute("title", "Test Module");
    fireEvent.click(moduleButton);
    expect(statsCard.textContent).not.toBe(withoutModule);

    fireEvent.click(screen.getByRole("button", { name: "Élite 1" }));
    expect(screen.getByRole("heading", { name: /Élite 1 nivel 1/ })).toBeInTheDocument();
    expect(level).toHaveValue("1");
    const trust = document.getElementById("stats-trust") as HTMLInputElement;
    fireEvent.change(trust, { target: { value: "0" } });
    expect(trust).toHaveValue("0");
  });

  it("shows only potential one and ranks with visible numeric bonuses", () => {
    const profile = { potentialRanks: [{ rank: 0, effects: [] }, { rank: 1, effects: [{ attributes: { attributeModifiers: [{ attributeType: "ATK", formulaItem: "ADDITION", value: 5 }] } }] }, { rank: 2, effects: [{ attributes: { attributeModifiers: [{ attributeType: "ATK", formulaItem: "CUSTOM", value: 1 }] } }] }] } as Pick<OperatorStatsProfile, "potentialRanks">;
    expect(getRelevantPotentialRanks(profile)).toEqual([3]);
    expect(officialPotentialToAppliedRanks(1)).toBe(0);
    expect(officialPotentialToAppliedRanks(2)).toBe(1);
    expect(officialPotentialToAppliedRanks(6)).toBe(5);
  });

  it("marks class and subclass icons unoptimized", () => {
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
    expect(images.filter((image) => image.getAttribute("data-unoptimized") === "true")).toHaveLength(2);
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
    expect(preload).toHaveAttribute("data-unoptimized", "false");

    fireEvent.load(preload!);

    const eliteTwo = document.querySelector(".operator-detail-illustration.is-elite2");
    expect(eliteTwo).toBeInTheDocument();
    expect(eliteTwo).toHaveAttribute("data-unoptimized", "false");
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

describe("OperatorDetailData skills tab", () => {
  const renderTab = (skills: Parameters<typeof OperatorDetailData>[0]["skills"]) => {
    render(<OperatorDetailData operator={operator} skills={skills} biography={{ status: "not-found", operatorId: operator.id, region: "en", revision: "test" }} tactical={null} artistCredit={null} />);
    fireEvent.click(screen.getByRole("tab", { name: "Habilidades" }));
    return screen.getByRole("heading", { name: "Habilidades" }).parentElement!;
  };
  const source = { repository: "test", revision: "test", path: "skill_table.json", sha256: "test" };

  it("receives the skills view without showing anything new yet", () => {
    const withoutView = renderTab(null);
    expect(withoutView).toHaveAttribute("data-skills-status", "unavailable");
    const text = withoutView.textContent;
    cleanup();
    expect(renderTab({ status: "empty", operatorId: operator.id, region: "en", source, ranges: {}, skills: [] })).toHaveAttribute("data-skills-status", "empty");
    cleanup();
    const available = renderTab({ status: "available", operatorId: operator.id, region: "en", source, ranges: {}, skills: [{ slot: 1, skillId: "skchr_test_1", activation: "manual", spRecovery: "time", icon: null, levels: [], defaultLevelIndex: -1, terms: {} }] });
    expect(available).toHaveAttribute("data-skills-status", "available");
    expect(available.textContent).toBe(text);
  });
});
