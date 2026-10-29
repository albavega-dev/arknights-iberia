import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/image", () => ({
  default: ({ unoptimized, ...props }: Record<string, unknown>) => <img {...props} alt={typeof props.alt === "string" ? props.alt : ""} data-testid="next-image" data-unoptimized={unoptimized === true ? "true" : "false"} />,
}));

import { OperatorSkillsPanel, OperatorTalentsPanel } from "../../src/app/operators/[slug]/operator-skills-panel";
import type { OperatorTacticalEntry } from "../../src/game-data/operator-tactical";
import type { BaseSkillStageView, OperatorBaseSkillView, OperatorSkillsView, OperatorSkillView, OperatorTalentView, SkillLevelLabel, SkillLevelView, TalentStageView } from "../../src/game-data/operator-skills-view";
import type { SkillDescriptionNode } from "../../src/game-data/skill-description";

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
const view = (skills: OperatorSkillView[], overrides: Partial<OperatorSkillsView> = {}): OperatorSkillsView => ({ status: "available", operatorId: "char_test", region: "en", source, ranges: {}, skills, baseSkills: [], talents: [], ...overrides });
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
    expect(mastery).toHaveClass("operator-skill-mastery");
    expect(mastery).not.toHaveClass("operator-filter-button");
    expect(within(screen.getByRole("radiogroup", { name: "Nivel de S1" })).getByRole("radio", { name: "M3" })).toHaveClass("operator-skill-mastery", "is-active");
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

  describe("glossary tooltips", () => {
    const termNode = (termId: string, text: string): SkillDescriptionNode => ({ type: "style", tag: `$${termId}`, tone: "status", termId, children: [{ type: "text", text }] });
    const terms = {
      "ba.stun": { name: "Aturdimiento", description: [{ type: "text" as const, text: "No puede actuar; ver " }, termNode("ba.sleep", "Dormir")] },
      "ba.sleep": { name: "Dormir", description: [{ type: "text" as const, text: "No puede actuar ni ser atacado" }] },
    };
    const termSkill = (slot: 1 | 2, name: string) => skill(slot, 1, { terms, levels: [level(0, { name, description: [{ type: "text", text: "Aplica " }, termNode("ba.stun", "Aturdir"), { type: "text", text: " y " }, termNode("ba.unknown", "Otro")] })] });
    const trigger = (name: string) => within(card(name)).getByRole("button", { name: "Aturdir" });
    const renderTerms = () => render(<OperatorSkillsPanel view={view([termSkill(1, "Primera"), termSkill(2, "Segunda")])} tactical={null} />);

    it("renders known terms as buttons that open and close their explanation", () => {
      renderTerms();
      const button = trigger("Primera");
      expect(button).toHaveAttribute("type", "button");
      expect(button).toHaveAttribute("aria-expanded", "false");
      expect(button).toHaveAttribute("data-term-id", "ba.stun");
      expect(button).not.toHaveAttribute("aria-controls");
      expect(card("Primera").querySelector('[data-term-id="ba.unknown"]')!.tagName).toBe("SPAN");
      fireEvent.click(button);
      const dialog = screen.getByRole("dialog", { name: "Aturdimiento" });
      expect(button).toHaveAttribute("aria-expanded", "true");
      expect(button).toHaveAttribute("aria-controls", dialog.id);
      expect(dialog).toHaveTextContent("AturdimientoNo puede actuar; ver Dormir");
      expect(document.activeElement).toBe(dialog);
      fireEvent.click(button);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(button).toHaveAttribute("aria-expanded", "false");
    });

    it("closes with Escape returning the focus, with a click outside and when the focus leaves", () => {
      renderTerms();
      const button = trigger("Primera");
      fireEvent.click(button);
      fireEvent.keyDown(document, { key: "Enter" });
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      fireEvent.keyDown(document, { key: "Escape" });
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(document.activeElement).toBe(button);
      fireEvent.click(button);
      fireEvent.pointerDown(screen.getByRole("dialog"));
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      fireEvent.pointerDown(document.body);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      fireEvent.click(button);
      fireEvent.blur(screen.getByRole("dialog"), { relatedTarget: button });
      fireEvent.blur(screen.getByRole("dialog"), { relatedTarget: null });
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      fireEvent.blur(screen.getByRole("dialog"), { relatedTarget: radios(1)[0] });
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("keeps a single explanation open across cards", () => {
      renderTerms();
      fireEvent.click(trigger("Primera"));
      fireEvent.click(trigger("Segunda"));
      expect(screen.getAllByRole("dialog")).toHaveLength(1);
      expect(trigger("Primera")).toHaveAttribute("aria-expanded", "false");
      expect(trigger("Segunda")).toHaveAttribute("aria-expanded", "true");
    });

    it("styles terms nested in an explanation without opening another one", () => {
      renderTerms();
      fireEvent.click(trigger("Primera"));
      const dialog = screen.getByRole("dialog");
      const nested = dialog.querySelector('[data-term-id="ba.sleep"]')!;
      expect(nested.tagName).toBe("SPAN");
      expect(nested).toHaveClass("operator-skill-tone", "is-status", "is-term");
      expect(within(dialog).queryByRole("button")).toBeNull();
    });

    it("places the explanation below the term or above it, inside the viewport", () => {
      renderTerms();
      const button = trigger("Primera");
      const size = vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(320);
      const height = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(120);
      Object.defineProperty(document.documentElement, "clientWidth", { configurable: true, value: 375 });
      const rect = (top: number, left: number) => vi.spyOn(button, "getBoundingClientRect").mockReturnValue({ top, bottom: top + 20, left, right: left + 60, width: 60, height: 20, x: left, y: top, toJSON: () => ({}) });
      rect(100, 300);
      fireEvent.click(button);
      expect(screen.getByRole("dialog").style).toMatchObject({ top: "126px", left: "39px" });
      fireEvent.click(button);
      rect(window.innerHeight - 40, 4);
      fireEvent.click(button);
      expect(screen.getByRole("dialog").style).toMatchObject({ top: `${window.innerHeight - 40 - 6 - 120}px`, left: "16px" });
      size.mockRestore();
      height.mockRestore();
      Reflect.deleteProperty(document.documentElement, "clientWidth");
    });
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

  describe("base skills", () => {
    const stage = (name: string, overrides: Partial<BaseSkillStageView> = {}): BaseSkillStageView => ({
      buffId: `buff_${name}`, name, room: "DORMITORY", icon: null, roomIcon: null, color: "#21cdcb", textColor: "#ffffff", unlock: { elite: 0, level: 1 }, description: [{ type: "text", text: `Efecto de ${name}` }], ...overrides,
    });
    const slot = (number: number, stages: BaseSkillStageView[], terms: OperatorBaseSkillView["terms"] = {}): OperatorBaseSkillView => ({ slot: number, stages, terms });
    const base = (slots: OperatorBaseSkillView[], overrides: Partial<OperatorSkillsView> = {}) => render(<OperatorSkillsPanel view={view([skill(1, 1)], { baseSkills: slots, ...overrides })} tactical={null} />);
    const section = () => screen.getByRole("region", { name: "Habilidades de base" });
    const stageRadios = (slot: number) => within(screen.getByRole("radiogroup", { name: `Promoción de la habilidad de base ${slot}` })).getAllByRole("radio");

    it("adds no section without base skills", () => {
      base([]);
      expect(screen.queryByRole("heading", { name: "Habilidades de base" })).not.toBeInTheDocument();
    });

    it("renders one slot with its icon, room tag, unlock and description, without a level selector", () => {
      base([slot(1, [stage("Penguin Logistics", { room: "TRADING", color: "#0075a9", icon: { src: "/assets/operator-base-skills/bskill_tra_spd1.png", width: 36, height: 36 }, roomIcon: { src: "/assets/operator-base-rooms/trading.png", width: 23, height: 23 } })])]);
      const item = within(section()).getByRole("article", { name: "Penguin Logistics" });
      expect(within(item).getAllByTestId("next-image").map((image) => image.getAttribute("src"))).toEqual(["/assets/operator-base-skills/bskill_tra_spd1.png", "/assets/operator-base-rooms/trading.png", "/assets/operator-elite/elite-0.png"]);
      expect(item.querySelector(".operator-base-skill-unlock")!.tagName).toBe("SPAN");
      expect(within(item).getAllByTestId("next-image")[0]).toHaveAttribute("width", "36");
      const room = item.querySelector(".operator-base-skill-room")!;
      expect(room).toHaveTextContent("Sala Trading Post");
      expect(room).toHaveStyle({ "--base-room-color": "#0075a9" });
      expect(item.querySelector(".operator-base-skill-unlock")).toHaveTextContent("Desbloqueo E0");
      expect(item).toHaveTextContent("Efecto de Penguin Logistics");
      expect(within(item).queryByRole("radiogroup")).toBeNull();
      expect(within(item).queryByRole("radio")).toBeNull();
    });

    it("renders two slots in order and names HIRE as HR Office", () => {
      base([slot(1, [stage("Primera", { room: "CONTROL" })]), slot(2, [stage("Segunda", { room: "HIRE", unlock: { elite: 2, level: 1 } })])]);
      expect(within(section()).getAllByRole("article").map((item) => within(item).getByRole("heading").textContent)).toEqual(["Primera", "Segunda"]);
      expect(card("Primera")).toHaveTextContent("Control Center");
      expect(card("Segunda")).toHaveTextContent("HR Office");
      expect(card("Segunda").querySelector(".operator-base-skill-unlock")).toHaveTextContent("E2");
    });

    it("uses dark text on light room colors and white on dark ones", () => {
      base([slot(1, [stage("Clara", { color: "#e3eb00" })]), slot(2, [stage("Oscura", { room: "TRAINING", color: "#7d0022" })]), slot(3, [stage("Sin color", { color: "teal" })])]);
      expect(card("Clara").querySelector(".operator-base-skill-room")).toHaveClass("is-dark-text");
      expect(card("Oscura").querySelector(".operator-base-skill-room")).toHaveClass("is-light-text");
      expect(card("Sin color").querySelector(".operator-base-skill-room")).toHaveClass("is-dark-text");
      expect(card("Sin color").querySelector(".operator-base-skill-room")).not.toHaveAttribute("style");
    });

    it("shows one stage of a replacement, the highest by default, and switches it from the promotion selector", () => {
      base([slot(1, [stage("Penguin Logistics α", { room: "TRADING" }), stage("Logistics Expert", { room: "TRADING", unlock: { elite: 2, level: 1 } })])]);
      const group = screen.getByRole("radiogroup", { name: "Promoción de la habilidad de base 1" });
      expect(stageRadios(1).map((radio) => radio.getAttribute("aria-label"))).toEqual(["E0", "E2"]);
      expect(stageRadios(1)[1]).toHaveAttribute("aria-checked", "true");
      expect(stageRadios(1)[1]).toHaveClass("is-active");
      expect(within(group.closest("article")!).getAllByRole("heading").map((heading) => heading.textContent)).toEqual(["Logistics Expert"]);
      expect(group.closest("article")).not.toHaveTextContent(/Sustitu/);
      fireEvent.click(stageRadios(1)[0]);
      expect(card("Penguin Logistics α")).toHaveTextContent("Efecto de Penguin Logistics α");
      expect(stageRadios(1)[0]).toHaveAttribute("aria-checked", "true");
      expect(stageRadios(1)[0]).toHaveAttribute("tabindex", "0");
      expect(stageRadios(1)[1]).toHaveAttribute("tabindex", "-1");
    });

    it("moves through three stages with arrows, Home and End (char_188_helage)", () => {
      base([slot(1, [stage("Release"), stage("Break Loose", { unlock: { elite: 1, level: 1 } }), stage("Absolution", { unlock: { elite: 2, level: 1 } })])]);
      const names = () => within(screen.getByRole("region", { name: "Habilidades de base" })).getByRole("article").querySelector("h3")!.textContent;
      expect(stageRadios(1).map((radio) => radio.getAttribute("aria-label"))).toEqual(["E0", "E1", "E2"]);
      expect(names()).toBe("Absolution");
      fireEvent.keyDown(stageRadios(1)[2], { key: "ArrowLeft" });
      expect(names()).toBe("Break Loose");
      expect(document.activeElement).toBe(stageRadios(1)[1]);
      fireEvent.keyDown(stageRadios(1)[1], { key: "Home" });
      expect(names()).toBe("Release");
      fireEvent.keyDown(stageRadios(1)[0], { key: "ArrowUp" });
      expect(names()).toBe("Absolution");
      fireEvent.keyDown(stageRadios(1)[2], { key: "ArrowRight" });
      expect(names()).toBe("Release");
      fireEvent.keyDown(stageRadios(1)[0], { key: "ArrowDown" });
      fireEvent.keyDown(stageRadios(1)[1], { key: "End" });
      expect(names()).toBe("Absolution");
      fireEvent.keyDown(stageRadios(1)[2], { key: "Tab" });
      expect(names()).toBe("Absolution");
    });

    it("labels an unlock at level 30 with its level", () => {
      base([slot(1, [stage("Antes"), stage("Después", { unlock: { elite: 0, level: 30 } })])]);
      expect(stageRadios(1).map((radio) => radio.getAttribute("aria-label"))).toEqual(["E0", "E0 · Nv. 30"]);
      expect(stageRadios(1).map((radio) => within(radio).getByTestId("next-image").getAttribute("src"))).toEqual(["/assets/operator-elite/elite-0.png", "/assets/operator-elite/elite-0.png"]);
      expect(stageRadios(1).map((radio) => radio.textContent)).toEqual(["", "Nv. 30"]);
      expect(screen.getByRole("radio", { name: "E0 · Nv. 30" })).toBeInTheDocument();
    });

    it("shows a fixed promotion icon with the level for a single stage unlocked at level 30", () => {
      base([slot(1, [stage("Única", { unlock: { elite: 0, level: 30 } })])]);
      const tag = card("Única").querySelector(".operator-base-skill-unlock")!;
      expect(tag.tagName).toBe("SPAN");
      expect(within(tag as HTMLElement).getByTestId("next-image")).toHaveAttribute("src", "/assets/operator-elite/elite-0.png");
      expect(tag).toHaveTextContent("Desbloqueo E0 · Nv. 30Nv. 30");
      expect(tag.querySelector('[aria-hidden="true"]')).toHaveTextContent("Nv. 30");
    });

    it("shows a CN-only operator, with the recycling room as in the data, even without combat skills", () => {
      render(<OperatorSkillsPanel view={view([], { status: "empty", region: "cn", baseSkills: [slot(1, [stage("回收", { room: "RECYCLE", color: "#6ccbcb" })]), slot(2, [stage("Taller", { room: "WORKSHOP", color: "#e3eb00" })])] })} tactical={null} />);
      expect(screen.queryByText("Este operador no tiene habilidades.")).not.toBeInTheDocument();
      expect(screen.getByText("回收站")).toHaveAttribute("lang", "zh-Hans");
      expect(card("Taller")).toHaveTextContent("Workshop");
      expect(screen.queryByText(/chino/)).not.toBeInTheDocument();
    });

    it("keeps the unknown room id and falls back when the icon is missing or fails", () => {
      base([slot(1, [stage("Rota", { room: "ELEVATOR", icon: { src: "/assets/operator-base-skills/rota.png", width: 36, height: 36 } })]), slot(2, [stage("Sin icono")])]);
      expect(card("Rota")).toHaveTextContent("ELEVATOR");
      expect(within(card("Sin icono")).getByTestId("skill-icon-fallback")).toHaveTextContent("B2");
      fireEvent.error(within(card("Rota")).getAllByTestId("next-image")[0]);
      expect(within(card("Rota")).getByTestId("skill-icon-fallback")).toHaveTextContent("B1");
    });

    it("opens glossary terms, sharing a single open explanation with the combat cards", () => {
      const terms = { "cc.g.lda": { name: "Lungmen Dollars", description: [{ type: "text" as const, text: "Moneda" }] } };
      const term: SkillDescriptionNode = { type: "style", tag: "$cc.g.lda", tone: "keyword", termId: "cc.g.lda", children: [{ type: "text", text: "LMD" }] };
      render(<OperatorSkillsPanel view={view([skill(1, 1, { terms, levels: [level(0, { name: "Combate", description: [term] })] })], { baseSkills: [slot(1, [stage("Base", { description: [term] })], terms)] })} tactical={null} />);
      fireEvent.click(within(card("Combate")).getByRole("button", { name: "LMD" }));
      fireEvent.click(within(card("Base")).getByRole("button", { name: "LMD" }));
      expect(screen.getAllByRole("dialog")).toHaveLength(1);
      expect(screen.getByRole("dialog", { name: "Lungmen Dollars" })).toHaveTextContent("Moneda");
      expect(within(card("Base")).getByRole("button", { name: "LMD" })).toHaveAttribute("aria-expanded", "true");
    });
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

describe("OperatorTalentsPanel", () => {
  const stage = (name: string, elite: 0 | 1 | 2, potential = 1, overrides: Partial<TalentStageView> = {}): TalentStageView => ({
    name, unlock: { elite, level: 1 }, potential, rangeId: null, description: [{ type: "text", text: `Efecto de ${name}` }], ...overrides,
  });
  const talent = (index: number, stages: TalentStageView[], terms: OperatorTalentView["terms"] = {}): OperatorTalentView => ({ index, stages, terms });
  const talents = (list: OperatorTalentView[], overrides: Partial<OperatorSkillsView> = {}) => render(<OperatorTalentsPanel view={view([], { status: "empty", talents: list, ...overrides })} />);
  const heading = () => screen.getByRole("article").querySelector("h3")!.textContent;
  const promotions = (position = 1) => within(screen.getByRole("radiogroup", { name: `Promoción del talento ${position}` })).getAllByRole("radio");
  const potentials = (position = 1) => within(screen.getByRole("group", { name: `Potencial del talento ${position}` })).getAllByRole("button");

  it("renders a single-stage talent without selectors (Frostleaf)", () => {
    talents([talent(0, [stage("Frost Bite", 2)]), talent(1, [stage("Segundo", 0)])]);
    expect(screen.getAllByRole("article").map((item) => within(item).getByRole("heading").textContent)).toEqual(["Frost Bite", "Segundo"]);
    expect(card("Frost Bite")).toHaveTextContent("Efecto de Frost Bite");
    expect(within(card("Frost Bite")).queryByRole("radiogroup")).toBeNull();
    expect(within(card("Frost Bite")).queryByRole("button")).toBeNull();
    expect(within(card("Frost Bite")).queryByTestId("next-image")).toBeNull();
  });

  it("shows the highest promotion by default and switches stages from the elite icons", () => {
    talents([talent(0, [stage("Base", 0), stage("Mejor", 1), stage("Máximo", 2)])]);
    expect(promotions().map((radio) => radio.getAttribute("aria-label"))).toEqual(["E0", "E1", "E2"]);
    expect(promotions().map((radio) => within(radio).getByTestId("next-image").getAttribute("src"))).toEqual([0, 1, 2].map((elite) => `/assets/operator-elite/elite-${elite}.png`));
    expect(promotions()[2]).toHaveAttribute("aria-checked", "true");
    expect(promotions()[2]).toHaveClass("is-active");
    expect(heading()).toBe("Máximo");
    fireEvent.click(promotions()[1]);
    expect(card("Mejor")).toHaveTextContent("Efecto de Mejor");
    fireEvent.keyDown(promotions()[1], { key: "Home" });
    expect(heading()).toBe("Base");
    expect(document.activeElement).toBe(promotions()[0]);
    expect(screen.queryByRole("group", { name: "Potencial del talento 1" })).toBeNull();
  });

  it("changes the stage and its name with the potential toggles, P1 when none is pressed (Lancet-2)", () => {
    talents([talent(0, [1, 2, 3, 4, 5, 6].map((potential) => stage(`Support Spray ${potential}`, 0, potential)))]);
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(potentials().map((button) => button.getAttribute("aria-label"))).toEqual(["Potencial 2", "Potencial 3", "Potencial 4", "Potencial 5", "Potencial 6"]);
    expect(potentials().map((button) => within(button).getByTestId("next-image").getAttribute("src"))).toEqual([2, 3, 4, 5, 6].map((potential) => `/assets/operator-potential/potential-${potential}.png`));
    expect(potentials().every((button) => button.getAttribute("aria-pressed") === "false")).toBe(true);
    expect(heading()).toBe("Support Spray 1");
    fireEvent.click(potentials()[3]);
    expect(heading()).toBe("Support Spray 5");
    expect(potentials()[3]).toHaveAttribute("aria-pressed", "true");
    expect(potentials()[3]).toHaveClass("is-active");
    fireEvent.click(potentials()[3]);
    expect(heading()).toBe("Support Spray 1");
  });

  it("lists only the potentials that change the talent and combines them with the promotion (char_1015_aglna2)", () => {
    talents([talent(0, [stage("A", 1), stage("A+", 1, 3), stage("B", 2), stage("B+", 2, 3)])]);
    expect(potentials().map((button) => button.getAttribute("aria-label"))).toEqual(["Potencial 3"]);
    expect(heading()).toBe("B");
    fireEvent.click(potentials()[0]);
    expect(heading()).toBe("B+");
    fireEvent.click(promotions()[0]);
    expect(heading()).toBe("A+");
    fireEvent.click(potentials()[0]);
    expect(heading()).toBe("A");
  });

  it("uses the last stage whose unlock and potential are met (Amiya P6)", () => {
    talents([talent(0, [stage("Mind Reading", 0), stage("Mind Reading", 1), stage("Mind Reading", 2), stage("Mind Reading", 2, 6, { description: [{ type: "style", tag: "@ba.talpu", tone: "potential", children: [{ type: "text", text: "extra" }] }] })])]);
    expect(card("Mind Reading").querySelector(".operator-skill-tone.is-potential")).toBeNull();
    fireEvent.click(potentials()[0]);
    expect(card("Mind Reading").querySelector(".operator-skill-tone.is-potential")).toHaveTextContent("extra");
    fireEvent.click(promotions()[1]);
    expect(card("Mind Reading")).toHaveTextContent("Efecto de Mind Reading");
  });

  it("labels a level variant with the elite icon and its level (Hibiscus)", () => {
    talents([talent(0, [stage("Healing Up", 1), stage("Healing Up", 1, 1, { unlock: { elite: 1, level: 55 }, description: [{ type: "text", text: "Mejorado" }] })])]);
    expect(promotions().map((radio) => radio.getAttribute("aria-label"))).toEqual(["E1", "E1 · Nv. 55"]);
    expect(promotions().map((radio) => radio.textContent)).toEqual(["", "Nv. 55"]);
    expect(card("Healing Up")).toHaveTextContent("Mejorado");
    fireEvent.click(promotions()[0]);
    expect(card("Healing Up")).toHaveTextContent("Efecto de Healing Up");
  });

  it("shows the stage's own range only when it has one", () => {
    const ranges = { "3-1": { direction: 1, grids: [{ row: 0, col: 1 }, { row: 0, col: 2 }] } };
    talents([talent(0, [stage("Sin rango", 1), stage("Con rango", 2, 1, { rangeId: "3-1" })])], { ranges });
    expect(card("Con rango").querySelector(".operator-talent-body")).toHaveClass("has-range");
    expect(within(card("Con rango")).getAllByLabelText("Casilla alcanzable")).toHaveLength(2);
    fireEvent.click(promotions()[0]);
    expect(card("Sin rango").querySelector(".operator-skill-range")).toBeNull();
    expect(card("Sin rango").querySelector(".operator-talent-body")).not.toHaveClass("has-range");
  });

  it("opens glossary terms with a single explanation across talents", () => {
    const terms = { "ba.root": { name: "Bind", description: [{ type: "text" as const, text: "No puede moverse" }] } };
    const term: SkillDescriptionNode = { type: "style", tag: "$ba.root", tone: "keyword", termId: "ba.root", children: [{ type: "text", text: "Bind" }] };
    talents([talent(0, [stage("Uno", 0, 1, { description: [term] })], terms), talent(1, [stage("Dos", 0, 1, { description: [term] })], terms)]);
    fireEvent.click(within(card("Uno")).getByRole("button", { name: "Bind" }));
    fireEvent.click(within(card("Dos")).getByRole("button", { name: "Bind" }));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog", { name: "Bind" })).toHaveTextContent("No puede moverse");
  });
});
