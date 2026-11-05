import { compareCodeUnits } from "../../src/game-data/string-order";
import { displayName, expect, expectedCount, newOperatorIds, openCatalog, operatorCards, publicSlugs, records, test, uniquelySearchable } from "./support";

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

  test("actualiza la URL al filtrar sin pedir la página al servidor", async ({ page }) => {
    const operator = globalOperators.find(uniquelySearchable)!;
    await openCatalog(page);
    const catalogRequests: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/operators") catalogRequests.push(request.url());
    });
    const controls = page.getByRole("search", { name: "Buscar y filtrar operadores" });
    await controls.getByRole("button", { name: operator.class, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`[?&]class=${operator.class}`));
    await controls.getByRole("button", { name: "Cambiar a orden ascendente" }).click();
    await expect(page).toHaveURL(/[?&]dir=asc/);
    await page.getByRole("button", { name: "Incluir exclusivos CN" }).click();
    await expect(page).toHaveURL(/[?&]cn=1/);
    await page.getByRole("group", { name: "Vista de la biblioteca" }).getByRole("button", { name: "Vista de avatares" }).click();
    await expect(page).toHaveURL(/[?&]view=avatars/);
    await page.getByRole("searchbox", { name: "Buscar" }).fill(displayName(operator));
    await expect(page).toHaveURL(/[?&]q=/);
    await controls.getByRole("button", { name: "Restablecer filtros" }).click();
    await expect(page).toHaveURL(/\/operators\?view=avatars$/);
    expect(catalogRequests).toEqual([]);
  });

  test("conserva los filtros al abrir una ficha y volver con atrás y adelante", async ({ page }) => {
    const operator = globalOperators.find(uniquelySearchable)!;
    await openCatalog(page, `?class=${operator.class}`);
    await page.getByRole("searchbox", { name: "Buscar" }).fill(displayName(operator));
    await expect(operatorCards(page)).toHaveCount(1);
    // The card is clicked right after the search, while the URL sync may still be pending.
    await operatorCards(page).first().click();
    await expect(page).toHaveURL(`/operators/${publicSlugs.get(operator.id)}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(displayName(operator));
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`[?&]q=.*class=${operator.class}|class=${operator.class}.*[?&]q=`));
    await expect(page.getByRole("searchbox", { name: "Buscar" })).toHaveValue(displayName(operator));
    await expect(operatorCards(page)).toHaveCount(1);
    await page.goForward();
    await expect(page).toHaveURL(`/operators/${publicSlugs.get(operator.id)}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(displayName(operator));
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
