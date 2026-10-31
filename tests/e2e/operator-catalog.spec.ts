import { compareCodeUnits } from "../../src/game-data/string-order";
import { displayName, expect, expectedCount, newOperatorIds, openCatalog, operatorCards, records, test, uniquelySearchable } from "./support";

const globalOperators = records.filter((operator) => !operator.cnOnly);

test.describe("catálogo de operadores", () => {
  test("muestra todos los operadores Global y oculta los exclusivos CN", async ({ page }) => {
    await openCatalog(page);
    await expect(operatorCards(page)).toHaveCount(expectedCount({}));
    await expect(page.locator("a.operator-card.is-cn-only")).toHaveCount(0);
  });

  test("busca por nombre y conserva la búsqueda en la URL", async ({ page }) => {
    const operator = globalOperators.find(uniquelySearchable)!;
    await openCatalog(page);
    await page.getByRole("searchbox", { name: "Buscar" }).fill(displayName(operator));
    await expect(operatorCards(page)).toHaveCount(1);
    await expect(operatorCards(page).first()).toContainText(displayName(operator));
    await expect(page).toHaveURL(/[?&]q=/);
    await page.reload();
    await expect(page.getByRole("searchbox", { name: "Buscar" })).toHaveValue(displayName(operator));
    await expect(operatorCards(page)).toHaveCount(1);
  });

  test("filtra por clase y rareza, y restablece los filtros", async ({ page }) => {
    const { class: className, rarity } = globalOperators[0]!;
    await openCatalog(page);
    const controls = page.getByRole("search", { name: "Buscar y filtrar operadores" });
    await controls.getByRole("button", { name: className, exact: true }).click();
    await expect(operatorCards(page)).toHaveCount(expectedCount({ className }));
    await expect(page).toHaveURL(new RegExp(`[?&]class=${className}`));
    await controls.getByRole("button", { name: `${rarity} estrellas`, exact: true }).click();
    await expect(operatorCards(page)).toHaveCount(expectedCount({ className, rarities: [rarity] }));
    await controls.getByRole("button", { name: "Restablecer filtros" }).click();
    await expect(operatorCards(page)).toHaveCount(expectedCount({}));
    await expect(page).toHaveURL(/\/operators$/);
  });

  test("recupera los filtros desde la URL y avisa cuando no hay resultados", async ({ page }) => {
    const { class: className } = globalOperators[0]!;
    await openCatalog(page, `?class=${className}&rarity=6,5`);
    await expect(operatorCards(page)).toHaveCount(expectedCount({ className, rarities: [6, 5] }));
    await page.goto("/operators?q=zzzz-sin-coincidencias");
    await expect(page.getByRole("status")).toHaveText(/No se encontraron operadores/);
    await expect(operatorCards(page)).toHaveCount(0);
  });

  test("el interruptor CN añade los exclusivos CN", async ({ page }) => {
    test.skip(!records.some((operator) => operator.cnOnly), "el catálogo no tiene exclusivos CN");
    await openCatalog(page);
    const toggle = page.getByRole("button", { name: "Incluir exclusivos CN" });
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(page).toHaveURL(/[?&]cn=1/);
    await expect(operatorCards(page)).toHaveCount(expectedCount({ includeCnOnly: true }));
    await expect(page.locator("a.operator-card.is-cn-only")).toHaveCount(records.filter((operator) => operator.cnOnly).length);
  });

  test("marca como NUEVO solo a los operadores de la última actualización Global abierta", async ({ page }) => {
    await openCatalog(page, "?cn=1");
    const labelled = page.locator("a.operator-card:has(.operator-card-new)");
    await expect(labelled).toHaveCount(newOperatorIds.size);
    const expectedNames = records.filter((operator) => newOperatorIds.has(operator.id)).map(displayName).sort(compareCodeUnits);
    const names = await labelled.locator(".operator-card-info strong").allInnerTexts();
    expect(names.sort(compareCodeUnits)).toEqual(expectedNames);
    await expect(page.locator("a.operator-card.is-cn-only .operator-card-new")).toHaveCount(0);
  });
});
