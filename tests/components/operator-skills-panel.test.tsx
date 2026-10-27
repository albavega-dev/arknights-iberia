import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/image", () => ({
  default: ({ unoptimized, ...props }: Record<string, unknown>) => <img {...props} alt={typeof props.alt === "string" ? props.alt : ""} data-testid="next-image" data-unoptimized={unoptimized === true ? "true" : "false"} />,
}));

import { OperatorSkillsPanel } from "../../src/app/operators/[slug]/operator-skills-panel";
import type { OperatorTacticalEntry } from "../../src/game-data/operator-tactical";
import type { OperatorSkillsView, OperatorSkillView, SkillLevelLabel, SkillLevelView } from "../../src/game-data/operator-skills-view";

const labels: SkillLevelLabel[] = ["1", "2", "3", "4", "5", "6", "7", "M1", "M2", "M3"];
const level = (index: number, overrides: Partial<SkillLevelView> = {}): SkillLevelView => ({
  index, label: labels[index], group: index < 7 ? "level" : "mastery", name: "Skill", icon: null, spCost: 40 - index, initialSp: 10 + index, duration: 20, durationKind: "seconds", rangeId: null,
  description: [{ type: "text", text: `Descripción ${labels[index]}` }], ...overrides,
});
const skill = (slot: 1 | 2 | 3, count: number, overrides: Partial<OperatorSkillView> = {}, levelOverrides: Partial<SkillLevelView> = {}): OperatorSkillView => ({
  slot, skillId: `skchr_test_${slot}`, activation: "manual", spRecovery: "time", unlock: { elite: (slot - 1) as 0 | 1 | 2, level: 1 }, icon: null,
  levels: Array.from({ length: count }, (_, index) => level(index, { name: `Habilidad ${slot}`, ...levelOverrides })), defaultLevelIndex: count - 1, terms: {}, ...overrides,
});
const source = { repository: "test", revision: "test", path: "skill_table.json", sha256: "test" };
const view = (skills: OperatorSkillView[], overrides: Partial<OperatorSkillsView> = {}): OperatorSkillsView => ({ status: "available", operatorId: "char_test", region: "en", source, ranges: {}, skills, ...overrides });
const card = (name: string) => screen.getByRole("article", { name });
const radios = (slot: number) => within(screen.getByRole("radiogroup", { name: `Nivel de S${slot}` })).getAllByRole("radio");
const checked = (slot: number) => radios(slot).find((radio) => radio.getAttribute("aria-checked") === "true")!.textContent;

describe("OperatorSkillsPanel", () => {
  it("shows the empty and unavailable states", () => {
    const { rerender } = render(<OperatorSkillsPanel view={view([], { status: "empty" })} tactical={null} />);
    expect(screen.getByText("Este operador no tiene habilidades.")).toBeInTheDocument();
    rerender(<OperatorSkillsPanel view={null} tactical={null} />);
    expect(screen.getByText("Habilidades no disponibles")).toBeInTheDocument();
  });

  it("renders one card per skill in order with its header, tags and slot", () => {
    render(<OperatorSkillsPanel view={view([skill(1, 10), skill(2, 10, { activation: "auto", spRecovery: "attack" }), skill(3, 10, { activation: "auto", spRecovery: "defense" })])} tactical={null} />);
    expect(screen.getAllByRole("article").map((item) => within(item).getByRole("heading").textContent)).toEqual(["Habilidad 1", "Habilidad 2", "Habilidad 3"]);
    expect(card("Habilidad 1")).toHaveTextContent("Recuperación automática");
    expect(card("Habilidad 1").querySelector(".is-recovery-time")).not.toBeNull();
    expect(card("Habilidad 1")).toHaveTextContent("Activación Manual");
    expect(card("Habilidad 1").querySelector(".operator-skill-slot")).toHaveTextContent("S1");
    expect(card("Habilidad 2")).toHaveTextContent("Recuperación ofensiva");
    expect(card("Habilidad 2")).toHaveTextContent("Activación Automática");
    expect(card("Habilidad 2")).not.toHaveTextContent("Desbloqueo");
    expect(card("Habilidad 3")).toHaveTextContent("Recuperación defensiva");
    expect(card("Habilidad 3").querySelector(".operator-skill-slot")).toHaveTextContent("S3");
  });

  it("starts each selector at the maximum level and only lists the existing levels in two groups", () => {
    render(<OperatorSkillsPanel view={view([skill(1, 10), skill(2, 7)])} tactical={null} />);
    expect(radios(1).map((radio) => radio.textContent)).toEqual(labels);
    expect(radios(2).map((radio) => radio.textContent)).toEqual(labels.slice(0, 7));
    expect(checked(1)).toBe("M3");
    expect(checked(2)).toBe("7");
    expect(screen.getByRole("radiogroup", { name: "Nivel de S1" }).children).toHaveLength(2);
    expect(screen.getByRole("radiogroup", { name: "Nivel de S2" }).children).toHaveLength(1);
    expect(card("Habilidad 1")).toHaveTextContent("Descripción M3");
  });

  it("shows the mastery icon with the label as accessible name", () => {
    const icon = (label: string) => ({ src: `/assets/operator-skill-mastery/m-${label.slice(1)}.png`, width: 250, height: 230 });
    render(<OperatorSkillsPanel view={view([skill(1, 10, { levels: Array.from({ length: 10 }, (_, index) => level(index, { name: "Maestría", icon: index >= 7 ? icon(labels[index]) : null })) })])} tactical={null} />);
    const mastery = within(screen.getByRole("radiogroup", { name: "Nivel de S1" })).getByRole("radio", { name: "M2" });
    expect(within(mastery).getByTestId("next-image")).toHaveAttribute("src", "/assets/operator-skill-mastery/m-2.png");
    expect(within(mastery).getByTestId("next-image")).toHaveAttribute("alt", "");
    expect(mastery).not.toHaveTextContent("M2");
    expect(within(screen.getByRole("radiogroup", { name: "Nivel de S1" })).getByRole("radio", { name: "7" })).toHaveTextContent("7");
  });

  it("moves the selection with arrows, Home and End, keeping a single tab stop, independently per card", () => {
    render(<OperatorSkillsPanel view={view([skill(1, 10), skill(2, 10)])} tactical={null} />);
    const first = radios(1);
    expect(first.filter((radio) => radio.tabIndex === 0)).toHaveLength(1);
    fireEvent.keyDown(first[9], { key: "Home" });
    expect(checked(1)).toBe("1");
    expect(document.activeElement).toBe(radios(1)[0]);
    fireEvent.keyDown(radios(1)[0], { key: "ArrowLeft" });
    expect(checked(1)).toBe("M3");
    fireEvent.keyDown(radios(1)[9], { key: "ArrowRight" });
    expect(checked(1)).toBe("1");
    fireEvent.keyDown(radios(1)[0], { key: "ArrowDown" });
    expect(checked(1)).toBe("2");
    fireEvent.keyDown(radios(1)[1], { key: "ArrowUp" });
    fireEvent.keyDown(radios(1)[0], { key: "End" });
    expect(checked(1)).toBe("M3");
    fireEvent.keyDown(radios(1)[9], { key: "Tab" });
    expect(checked(1)).toBe("M3");
    fireEvent.click(radios(1)[3]);
    expect(checked(1)).toBe("4");
    expect(radios(1)[3]).toHaveAttribute("tabindex", "0");
    expect(card("Habilidad 1")).toHaveTextContent("Descripción 4");
    expect(card("Habilidad 1")).toHaveTextContent("SP inicial13Coste de SP37");
    expect(checked(2)).toBe("M3");
  });

  it("shows the special duration and SP values as text, without notes", () => {
    const special = (durationKind: SkillLevelView["durationKind"], duration: number) => ({ durationKind, duration });
    render(<OperatorSkillsPanel view={view([
      skill(1, 1, { levels: [level(0, { name: "Instantánea", ...special("instant", 0) })] }),
      skill(2, 1, { levels: [level(0, { name: "Ilimitada", ...special("unlimited", -1) })] }),
      skill(3, 1, { levels: [level(0, { name: "Munición", ...special("ammo", -1) })] }),
    ])} tactical={null} />);
    expect(card("Instantánea")).toHaveTextContent("DuraciónInstantánea");
    expect(card("Ilimitada")).toHaveTextContent("DuraciónSin límite");
    expect(card("Munición")).toHaveTextContent("DuraciónSegún munición");
    expect(card("Munición").querySelector(".operator-skill-values")).toHaveTextContent(/DuraciónSegún munición$/);
    expect(card("Instantánea")).not.toHaveTextContent("-1");
  });

  it("shows dashes without notes for passive skills and missing values", () => {
    render(<OperatorSkillsPanel view={view([
      skill(1, 1, { activation: "passive", spRecovery: "none", levels: [level(0, { name: "Pasiva", spCost: 0, initialSp: 0, duration: 0, durationKind: "none" })] }),
      skill(2, 1, { levels: [level(0, { name: "Incompleta", spCost: null, initialSp: 5, duration: null, durationKind: "unknown" })] }),
    ])} tactical={null} />);
    expect(card("Pasiva").querySelector(".operator-skill-values")).toHaveTextContent(/^SP inicial—Coste de SP—Duración—$/);
    expect(card("Pasiva")).toHaveTextContent("Activación Pasiva");
    expect(card("Pasiva")).not.toHaveTextContent("Recuperación");
    expect(card("Incompleta").querySelector(".operator-skill-values")).toHaveTextContent(/^SP inicial5Coste de SP—Duración—$/);
  });

  it("expands and collapses an accessible table with every level", () => {
    render(<OperatorSkillsPanel view={view([skill(1, 10, {}, { durationKind: "seconds", duration: 1.5 })])} tactical={null} />);
    const toggle = screen.getByRole("button", { name: "Mostrar niveles" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveTextContent("Ocultar niveles");
    const region = screen.getByRole("region", { name: "Valores por nivel de S1" });
    expect(toggle).toHaveAttribute("aria-controls", region.id);
    const rows = within(region).getAllByRole("row");
    expect(rows).toHaveLength(11);
    expect(within(rows[0]).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Nivel", "SP inicial", "Coste de SP", "Duración"]);
    expect(within(rows[10]).getByRole("rowheader")).toHaveTextContent("M3");
    expect(rows[10]).toHaveTextContent("M319311,5 s");
    fireEvent.click(toggle);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("does not repeat the CN availability notice of the operator header", () => {
    render(<OperatorSkillsPanel view={view([skill(1, 7)], { region: "cn" })} tactical={null} />);
    expect(screen.queryByText(/chino/)).not.toBeInTheDocument();
  });

  it("renders description nodes as elements with tones and glossary ids, never as HTML", () => {
    render(<OperatorSkillsPanel view={view([skill(1, 1, { levels: [level(0, { name: "Tonos", description: [
      { type: "text", text: "ATK " },
      { type: "style", tag: "@ba.vup", tone: "increase", children: [{ type: "text", text: "+" }, { type: "value", key: "atk", display: "110 %", percent: true }] },
      { type: "lineBreak" },
      { type: "style", tag: "@ba.vdown", tone: "decrease", children: [{ type: "text", text: "-20 %" }] },
      { type: "style", tag: "$ba.stun", tone: "status", termId: "ba.stun", children: [{ type: "text", text: "Stun" }] },
      { type: "unknownMarker", text: "{duration}" },
      { type: "text", text: "<b>literal</b>" },
    ] })] })])} tactical={null} />);
    const description = card("Tonos").querySelector(".operator-skill-description")!;
    expect(description.querySelector(".is-increase")).toHaveTextContent("+110 %");
    expect(description.querySelector(".operator-skill-value")).toHaveTextContent("110 %");
    expect(description.querySelector(".is-decrease")).toHaveTextContent("-20 %");
    expect(description.querySelector("br")).not.toBeNull();
    const term = description.querySelector(".is-term")!;
    expect(term).toHaveAttribute("data-term-id", "ba.stun");
    expect(term).toHaveClass("is-status");
    expect(description.querySelector(".operator-skill-unknown")).toHaveTextContent("{duration}");
    expect(description.querySelector("b")).toBeNull();
    expect(description).toHaveTextContent("<b>literal</b>");
  });

  it("uses the icon when available and the fallback when it is missing or fails", () => {
    render(<OperatorSkillsPanel view={view([skill(1, 1, { icon: { src: "/assets/operator-skills/test.png", width: 128, height: 128 } }), skill(2, 1)])} tactical={null} />);
    const icon = within(card("Habilidad 1")).getByTestId("next-image");
    expect(icon).toHaveAttribute("src", "/assets/operator-skills/test.png");
    expect(icon).toHaveAttribute("data-unoptimized", "true");
    expect(within(card("Habilidad 2")).getByTestId("skill-icon-fallback")).toHaveTextContent("S2");
    fireEvent.error(icon);
    expect(within(card("Habilidad 1")).getByTestId("skill-icon-fallback")).toHaveAttribute("aria-hidden", "true");
  });

  it("shows the skill range, or the operator range at its highest promotion, without headings", () => {
    const tactical: OperatorTacticalEntry = { id: "char_test", source: null, position: "RANGED", tags: [], phases: [{ phase: 0, rangeId: "3-1", rangeKey: "en:3-1" }, { phase: 1, rangeId: "3-3", rangeKey: "en:3-3" }, { phase: 2, rangeId: null, rangeKey: "missing" }] };
    const ranges = { "1-1": { direction: 1, grids: [{ row: 0, col: 1 }] }, "1-2": { direction: 1, grids: [{ row: 0, col: 1 }, { row: 0, col: 2 }] } };
    const { rerender } = render(<OperatorSkillsPanel view={view([skill(1, 2, { levels: [level(0, { name: "Propio", rangeId: "1-1" }), level(1, { name: "Propio", rangeId: "1-2" })] }), skill(2, 1, {}, { name: "Del operador" })], { ranges })} tactical={tactical} />);
    expect(card("Propio").querySelector(".operator-tactical-range-heading")).toBeNull();
    expect(within(card("Propio")).getAllByLabelText("Casilla alcanzable")).toHaveLength(2);
    fireEvent.click(radios(1)[0]);
    expect(within(card("Propio")).getAllByLabelText("Casilla alcanzable")).toHaveLength(1);
    const operatorRange = card("Del operador").querySelector(".operator-skill-range")!;
    expect(operatorRange.querySelector(".operator-tactical-range-heading")).toBeNull();
    expect(within(card("Del operador")).getAllByLabelText("Casilla alcanzable").length).toBeGreaterThan(0);
    rerender(<OperatorSkillsPanel view={view([skill(1, 1, {}, { name: "Sin rango" })])} tactical={null} />);
    expect(card("Sin rango").querySelector(".operator-skill-range")).toBeNull();
  });
});
