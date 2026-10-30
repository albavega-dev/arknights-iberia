import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/image", () => ({
  default: ({ unoptimized, ...props }: Record<string, unknown>) => <img {...props} alt={typeof props.alt === "string" ? props.alt : ""} data-testid="next-image" data-unoptimized={unoptimized === true ? "true" : "false"} />,
}));

import { OperatorDetailData } from "../../src/app/operators/[slug]/operator-detail-data";
import { OperatorModulesPanel } from "../../src/app/operators/[slug]/operator-modules-panel";
import type { GameDataRegion } from "../../src/game-data/gamedata-revisions";
import type { DatasetIndex } from "../../src/game-data/operator-dataset";
import { moduleArtResolver, type ModuleArtManifest } from "../../src/game-data/operator-module-art";
import { buildOperatorModulesView, type OperatorModulesView, type StoredModulesProfile } from "../../src/game-data/operator-modules-view";
import { buildOperatorSkillsView, type OperatorSkillsView, type StoredSkillsGlossary, type StoredSkillsProfile } from "../../src/game-data/operator-skills-view";
import type { OperatorStatsProfile } from "../../src/game-data/operator-stats";
import type { OperatorRecord } from "../../src/game-data/operators";

// The real datasets, read without the server-only loaders.
const readJson = <T,>(file: string): T => JSON.parse(readFileSync(resolve(import.meta.dirname, "../../data", file), "utf8")) as T;
const modulesOf = (operatorId: string, region: GameDataRegion = "en"): OperatorModulesView => {
  const profile = readJson<StoredModulesProfile>(`operator-modules/${operatorId}.json`);
  const glossaries = { en: readJson<StoredSkillsGlossary>("operator-modules/glossary-en.json"), cn: readJson<StoredSkillsGlossary>("operator-modules/glossary-cn.json") };
  return buildOperatorModulesView(profile, statsOf(operatorId, region).trait, region, readJson<DatasetIndex>("operator-modules/index.json").sources[region], glossaries, moduleArtResolver(readJson<ModuleArtManifest>("operator-module-art-manifest.json")));
};
const skillsOf = (operatorId: string, region: GameDataRegion = "en"): OperatorSkillsView => buildOperatorSkillsView(readJson<StoredSkillsProfile>(`operator-skills/${operatorId}.json`), region, readJson<DatasetIndex>("operator-skills/index.json").sources[region], readJson<StoredSkillsGlossary>(`operator-skills/glossary-${region}.json`), () => null);
const statsOf = (operatorId: string, region: GameDataRegion = "en"): OperatorStatsProfile => ({ ...readJson<Omit<OperatorStatsProfile, "source">>(`operator-stats/${operatorId}.json`), source: readJson<DatasetIndex>("operator-stats/index.json").sources[region] });

const panel = (view: OperatorModulesView, show = false, onChange = () => {}) => <OperatorModulesPanel view={view} showCnModules={show} onShowCnModulesChange={onChange} />;
const cards = () => screen.queryAllByRole("article");
const card = (name: string) => screen.getByRole("article", { name });
// The level columns of the module itself, not those of its summon or game mode blocks.
const level = (article: HTMLElement, number: number) => within(article.querySelector<HTMLElement>(".operator-module-body .operator-module-levels")!).getByRole("region", { name: `Nivel ${number}` });
/** Attributes of a level column, one list item each. */
const items = (element: HTMLElement) => within(element.querySelector<HTMLElement>(".operator-module-attributes")!).getAllByRole("listitem").map((item) => item.textContent);
const changed = (element: Element) => [...element.querySelectorAll(".operator-skill-value.is-changed")].map((item) => item.textContent);
/** A copy of a real view with one module changed, for cases the current data does not have. */
const variant = (view: OperatorModulesView, change: (module: OperatorModulesView["modules"][number]) => void): OperatorModulesView => {
  const copy = structuredClone(view);
  change(copy.modules[0]);
  return copy;
};

describe("OperatorModulesPanel", () => {
  it("Kal'tsit: every module in a list, with band, illustration, level icons and compact attributes", () => {
    render(panel(modulesOf("char_003_kalts")));
    expect(screen.getByRole("heading", { level: 2, name: "Módulos" })).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    expect(cards().map((article) => article.querySelector("h3")!.textContent)).toEqual(["Mon2tr", "Panacea", "Kal'tsit's Specialized Badge"]);
    expect(screen.queryByRole("button", { name: "Incluir módulos CN" })).not.toBeInTheDocument();
    const x = card("Mon2tr");
    expect(x.querySelector(".operator-module-band .operator-module-code")).toHaveTextContent("PHY-X");
    expect(within(x).getByRole("img", { name: "Ilustración del módulo Mon2tr" })).toHaveAttribute("src", "/assets/operator-modules-art/uniequip_002_kalts.webp");
    expect(within(x).getByRole("img", { name: "Ilustración del módulo Mon2tr" })).toHaveAttribute("data-unoptimized", "true");
    expect(x.querySelector(".operator-module-body")).toHaveClass("has-art");
    expect(x.querySelector(".operator-module-body .operator-module-levels")!.children).toHaveLength(3);
    expect(within(level(x, 2)).getByRole("heading", { level: 4, name: "Nivel 2" }).querySelector("img")).toHaveAttribute("src", "/assets/operator-module-stages/stage-2.png");
    // Compact attributes; the values that differ from the previous level are highlighted.
    expect(items(level(x, 1))).toEqual(["ATK +35", "DEF +15"]);
    expect(changed(level(x, 1).querySelector(".operator-module-attributes")!)).toEqual([]);
    expect(items(level(x, 3))).toEqual(["ATK +60", "DEF +25"]);
    expect(changed(level(x, 3).querySelector(".operator-module-attributes")!)).toEqual(["+60", "+25"]);
    expect(x.querySelector(".operator-module-attributes img")).toBeNull();
    // Talent change, its changed numbers, and the potential in the band changing every column.
    expect(within(level(x, 1)).queryByRole("heading", { level: 5 })).not.toBeInTheDocument();
    expect(within(level(x, 2)).getByRole("heading", { level: 5, name: "Non-Damaging Restructuring" })).toBeInTheDocument();
    expect(changed(level(x, 2).querySelector(".operator-module-talent")!)).toEqual([]);
    expect(changed(level(x, 3).querySelector(".operator-module-talent")!).length).toBeGreaterThan(0);
    const potential = within(x.querySelector<HTMLElement>(".operator-module-band")!).getByRole("button", { name: "Potencial 5" });
    expect(level(x, 3)).toHaveTextContent("for 3.5 seconds");
    fireEvent.click(potential);
    expect(potential).toHaveAttribute("aria-pressed", "true");
    expect(level(x, 2)).toHaveTextContent("(+0.5)");
    expect(level(x, 3)).toHaveTextContent("(+0.5)");
    fireEvent.click(potential);
    expect(level(x, 3)).toHaveTextContent("for 3.5 seconds");
    // Trait, then the summon block (its texts differ from the operator's) and no unlock or missions.
    expect(x.querySelector(".operator-module-trait-base")).toHaveTextContent("Restores the HP of allies");
    expect(x.querySelector(".operator-module-trait-addition")).toHaveTextContent("increases heal amount by 15%");
    expect(within(x.querySelector<HTMLElement>(".operator-module-trait-addition")!).getByText("Añadido por el módulo PHY-X:")).toHaveClass("sr-only");
    const token = x.querySelector<HTMLElement>(".operator-module-token")!;
    expect(token.querySelector(":scope > h4")).toHaveTextContent("Mon3tr");
    expect(within(token).getByRole("region", { name: "Nivel 1" })).toHaveTextContent("—");
    expect(within(token).getByRole("region", { name: "Nivel 2" })).toHaveTextContent("When defeated (excluding retreat)");
    expect(x).not.toHaveTextContent(/Desbloqueo|Misiones|Confianza/);
    expect(within(card("Kal'tsit's Specialized Badge")).getByText("Limited Modality")).toHaveClass("operator-skill-tag", "operator-module-tag");
  });

  it("Passenger: potentials per module and a Limited Modality badge", () => {
    render(panel(modulesOf("char_472_pasngr")));
    expect(cards()).toHaveLength(3);
    expect(within(cards()[0]).getAllByRole("button", { name: /^Potencial/ }).length).toBeGreaterThan(0);
    expect(within(cards()[2]).getByText("Limited Modality")).toBeInTheDocument();
  });

  it("Shu: the CN module only with the switch next to the title, with its CN tag", () => {
    const view = modulesOf("char_2025_shu");
    const onChange = vi.fn();
    const { rerender } = render(panel(view, false, onChange));
    expect(cards()).toHaveLength(1);
    const toggle = screen.getByRole("button", { name: "Incluir módulos CN" });
    expect(toggle.parentElement).toHaveClass("operator-modules-heading");
    expect(toggle).toHaveClass("operators-cn-toggle", "operator-modules-cn-toggle");
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(true);
    rerender(panel(view, true, onChange));
    expect(screen.getByRole("button", { name: "Incluir módulos CN" })).toHaveClass("is-active");
    expect(within(card("好时节")).getByText("CN")).toHaveClass("operator-module-tag");
    expect(within(card("On Architecture of Time")).queryByText("CN")).not.toBeInTheDocument();
  });

  it("Makoto: a CN operator shows its modules without the switch or the CN tag", () => {
    render(panel(modulesOf("char_4217_makoto", "cn")));
    expect(screen.queryByRole("button", { name: "Incluir módulos CN" })).not.toBeInTheDocument();
    const shown = card("彼此的声音");
    expect(within(shown).queryByText("CN")).not.toBeInTheDocument();
    expect(items(level(shown, 1))).toEqual(["PV +200", "ATK +18", "DEF +18"]);
    expect(changed(level(shown, 3).querySelector(".operator-module-talent")!).length).toBeGreaterThan(0);
  });

  it("Tequila: the replaced trait and the added part", () => {
    render(panel(modulesOf("char_486_takila")));
    const shown = cards()[0];
    expect(within(shown).getByText("Rasgo sustituido")).toBeInTheDocument();
    expect(shown.querySelector(".operator-module-trait-base")).toBeNull();
    expect(shown.querySelector(".operator-module-trait-override")).toHaveTextContent("ATK gradually increases up to +200%");
    expect(shown.querySelector(".operator-module-trait-addition")).toHaveTextContent("Directly gains +100% charge after deployment");
  });

  it("Whislash: a talent the module adds, without potential choices or trait section", () => {
    render(panel(modulesOf("char_265_sophia")));
    const shown = cards()[0];
    expect(within(shown).queryByRole("button", { name: /^Potencial/ })).not.toBeInTheDocument();
    expect(within(level(shown, 2)).getByRole("heading", { level: 5, name: /Vision of Unity/ })).toHaveTextContent("Nuevo talento");
    expect(within(shown).queryByRole("heading", { name: "Rasgo" })).not.toBeInTheDocument();
  });

  it("Raidian: effects of a game mode apart, tagged with the mode", () => {
    render(panel(modulesOf("char_4195_radian")));
    const modes = card("Start+").querySelectorAll<HTMLElement>(".operator-module-mode");
    expect([...modes].map((mode) => mode.querySelector(".operator-module-tag")!.textContent)).toEqual(["Sui's Garden of Grotesqueries", "Integrated Strategies · Sui's Garden of Grotesqueries"]);
    expect(modes[0]).toHaveTextContent("attacks one additional target");
    expect(within(modes[1]).getByRole("region", { name: "Nivel 1" })).toHaveTextContent("—");
    expect(within(modes[1]).getByRole("region", { name: "Nivel 2" })).toHaveTextContent("Cassette Inspiration");
  });

  it("Pepe: a mode effect that repeats the normal one is not shown again", () => {
    render(panel(modulesOf("char_4058_pepe")));
    const badge = card("Pepe's Specialized Badge");
    expect(within(level(badge, 2)).getByRole("heading", { level: 5, name: "Perfuse With Lotus" })).toBeInTheDocument();
    expect(badge.querySelector(".operator-module-mode")).toBeNull();
  });

  it("summons: identical texts are left out, several summons are named, and summon traits are shown", () => {
    const { unmount } = render(panel(modulesOf("char_4171_wulfen")));
    expect(cards()[0].querySelector(".operator-module-token")).toBeNull();
    unmount();
    const ling = render(panel(modulesOf("char_2023_ling")));
    const token = cards()[0].querySelector<HTMLElement>(".operator-module-token")!;
    expect(token.querySelectorAll(".operator-module-attributes-label").length).toBeGreaterThan(0);
    expect(token.querySelector(":scope > h4")!.textContent).toContain(" / ");
    ling.unmount();
    render(panel(modulesOf("char_391_rosmon")));
    expect(screen.getAllByRole("article").some((article) => article.querySelector(".operator-module-token .operator-module-trait-addition, .operator-module-token .operator-module-trait-override"))).toBe(true);
  });

  it("Rosesa: the range the module gives", () => {
    render(panel(modulesOf("char_4163_rosesa")));
    expect(within(cards()[0]).getByRole("heading", { level: 4, name: "Alcance" }).nextElementSibling!.querySelectorAll(".operator-range-cell.is-reachable").length).toBeGreaterThan(0);
  });

  it("cases the data does not have yet: no art or icon, several trait groups, a mode range, and no module shown", () => {
    const kaltsit = modulesOf("char_003_kalts");
    const { unmount } = render(panel(variant(kaltsit, (module) => {
      module.art = null;
      module.icon = null;
      module.levels[2].traits = [{ token: false, override: null, addition: [{ type: "text", text: "Distinto en el nivel 3" }] }];
      module.levels[1].modes = [{ gameTag: "sandbox", mapTag: null, rangeId: "3-1", traits: [], talents: [] }];
    })));
    const shown = card("Mon2tr");
    expect(shown.querySelector(".operator-module-body")).not.toHaveClass("has-art");
    expect(shown.querySelector(".operator-module-icon")).toBeNull();
    expect([...shown.querySelectorAll(".operator-module-trait-levels")].map((item) => item.textContent)).toEqual(["Niveles 1 y 2", "Nivel 3"]);
    const mode = shown.querySelector<HTMLElement>(".operator-module-mode")!;
    expect(mode.querySelector(".operator-module-tag")).toHaveTextContent("Reclamation Algorithm");
    unmount();
    render(panel({ ...modulesOf("char_2025_shu"), modules: modulesOf("char_2025_shu").modules.filter((item) => item.region === "cn") }));
    expect(cards()).toHaveLength(0);
    expect(screen.getByText("Este operador todavía no tiene módulos en Global.")).toBeInTheDocument();
  });
});

describe("Modules in the operator detail", () => {
  const record = (id: string, cnOnly = false): OperatorRecord => ({ id, name: id, cnName: null, globalName: null, class: "Medic", subClassId: null, rarity: 6, slug: id, cnOnly, availabilityStatus: "global-snapshot", cnReleaseDate: null, globalReleaseDate: null, mainPowerNationId: null, mainPowerGroupId: null, mainPowerTeamId: null, mainFactionId: null });
  const biography = (id: string) => ({ status: "not-found" as const, operatorId: id, region: "en" as const, revision: "test" });
  const detail = (id: string, modules: OperatorModulesView | null, region: GameDataRegion = "en") => <OperatorDetailData operator={record(id, region === "cn")} stats={statsOf(id, region)} skills={skillsOf(id, region)} modules={modules} biography={biography(id)} tactical={null} artistCredit={null} />;
  const talents = () => screen.getByRole("region", { name: "Rasgo y talentos" });

  it("shows the Modules tab only with modules", () => {
    const { rerender } = render(detail("char_003_kalts", null));
    expect(screen.queryByRole("tab", { name: "Módulos" })).not.toBeInTheDocument();
    rerender(detail("char_003_kalts", modulesOf("char_003_kalts")));
    fireEvent.click(screen.getByRole("tab", { name: "Módulos" }));
    expect(screen.getByRole("tabpanel").querySelector(".operator-skills-tab.operator-modules-tab")).toBeInTheDocument();
    rerender(detail("char_003_kalts", null));
    expect(screen.getByRole("tab", { name: "Estadísticas" })).toHaveAttribute("aria-selected", "true");
  });

  it("Stats: the chosen module level changes the affected talent cards, with the module mark", () => {
    render(detail("char_003_kalts", modulesOf("char_003_kalts")));
    const name = () => within(talents()).getAllByRole("article").map((card) => card.querySelector("h3")!.textContent);
    const before = name();
    expect(talents().querySelector(".operator-talent-card.is-module")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /PHY-X: Mon2tr/ }));
    expect(talents().querySelector(".operator-talent-card.is-module")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Etapa de módulo 2" }));
    const marked = talents().querySelector(".operator-talent-card.is-module")!;
    expect(marked).toHaveTextContent("Non-Damaging Restructuring");
    expect(within(marked as HTMLElement).getByText("Modificado por el módulo PHY-X")).toHaveClass("sr-only");
    expect(name()).toEqual(before);
    fireEvent.click(screen.getByRole("button", { name: "Potencial 5" }));
    expect(marked).toHaveTextContent("(+0.5)");
    fireEvent.click(screen.getByRole("button", { name: /PHY-X: Mon2tr/ }));
    expect(talents().querySelector(".operator-talent-card.is-module")).toBeNull();
  });

  it("Stats: the trait card comes first and follows the promotion selector", () => {
    render(detail("char_337_utage", modulesOf("char_337_utage")));
    const trait = within(talents()).getAllByRole("article")[0];
    expect(trait).toHaveAccessibleName("Rasgo");
    expect(trait).toHaveTextContent("Recovers 70 self HP");
    expect(trait).not.toHaveTextContent("Upgraded");
    fireEvent.click(screen.getByRole("button", { name: "Élite 0" }));
    expect(trait).toHaveTextContent("Recovers 30 self HP every time this operator attacks an enemy (Upgraded after reaching Elite 1)");
    fireEvent.click(screen.getByRole("button", { name: "Élite 1" }));
    expect(trait).toHaveTextContent("Recovers 50 self HP");
  });

  it("Stats: the selected module replaces the trait or appends its part in the module tone", () => {
    render(detail("char_486_takila", modulesOf("char_486_takila")));
    const trait = () => within(talents()).getAllByRole("article")[0];
    const base = trait().textContent;
    expect(trait()).not.toHaveClass("is-module");
    fireEvent.click(screen.getByRole("button", { name: /^LIB-X: / }));
    expect(trait()).toHaveClass("is-module");
    expect(within(trait()).getByText("Sustituido por el módulo LIB-X")).toHaveClass("sr-only");
    expect(trait()).toHaveTextContent("ATK gradually increases up to +200%");
    expect(trait().querySelector(".operator-module-trait-addition")).toHaveTextContent("Añadido por el módulo LIB-X: Directly gains +100% charge after deployment");
    fireEvent.click(screen.getByRole("button", { name: /^LIB-X: / }));
    expect(trait().textContent).toBe(base);
    expect(trait().querySelector(".operator-module-trait-addition")).toBeNull();
  });

  it("Stats: a talent the module adds appears after the operator's own", () => {
    render(detail("char_265_sophia", modulesOf("char_265_sophia")));
    fireEvent.click(screen.getByRole("button", { name: /INS-X/ }));
    fireEvent.click(screen.getByRole("button", { name: "Etapa de módulo 3" }));
    const cards = within(talents()).getAllByRole("article");
    expect(cards.at(-1)).toHaveTextContent("Vision of Unity");
    expect(within(cards.at(-1)!).getByText("Añadido por el módulo INS-X")).toBeInTheDocument();
  });

  it("Stats: no CN switch for an operator without CN modules", () => {
    render(detail("char_003_kalts", modulesOf("char_003_kalts")));
    expect(screen.queryByRole("button", { name: "Incluir módulos CN" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Configuración de estadísticas" })).toBeInTheDocument();
  });

  it("Shu: one CN switch shared by the Modules tab and Stats", () => {
    render(detail("char_2025_shu", modulesOf("char_2025_shu")));
    const statsToggle = () => screen.getByRole("button", { name: "Incluir módulos CN" });
    expect(screen.queryByRole("button", { name: /GUA-Y/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Módulos" }));
    fireEvent.click(screen.getByRole("button", { name: "Incluir módulos CN" }));
    expect(cards()).toHaveLength(2);
    fireEvent.click(screen.getByRole("tab", { name: "Estadísticas" }));
    expect(statsToggle()).toHaveAttribute("aria-pressed", "true");
    const selectors = screen.getByRole("region", { name: "Configuración de estadísticas" });
    expect(selectors).not.toContainElement(statsToggle());
    expect(statsToggle().nextElementSibling).toBe(selectors);
    fireEvent.click(screen.getByRole("button", { name: /GUA-Y/ }));
    fireEvent.click(screen.getByRole("button", { name: "Etapa de módulo 3" }));
    expect(screen.getByRole("region", { name: "Estadísticas calculadas" })).toBeInTheDocument();
    expect(talents().querySelector(".operator-talent-card.is-module")).toHaveTextContent("天有四时");
    fireEvent.click(statsToggle());
    expect(screen.queryByRole("button", { name: /GUA-Y/ })).not.toBeInTheDocument();
    expect(talents().querySelector(".operator-talent-card.is-module")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Módulos" }));
    expect(cards().filter((article) => article.classList.contains("operator-module-card"))).toHaveLength(1);
  });
});
