import { catalogOperators, displayName, expect, openCatalog, operatorCards, publicSlugs, readModules, records, test, uniquelySearchable } from "./support";

const globalOperators = records.filter((operator) => !operator.cnOnly);
const withModules = globalOperators.find((operator) => readModules(operator.id).some((module) => module.region === "en") && uniquelySearchable(operator))!;
const withCnModule = globalOperators.find((operator) => readModules(operator.id).some((module) => module.region === "cn"));
const cnOnly = records.find((operator) => operator.cnOnly);
const renamed = catalogOperators.find((operator) => operator.previousSlugs.length);

test.describe("fichas de operador", () => {
  test("se abre desde el catálogo y recorre sus pestañas", async ({ page }) => {
    await openCatalog(page);
    await page.getByRole("searchbox", { name: "Buscar" }).fill(displayName(withModules));
    await operatorCards(page).first().click();
    await expect(page).toHaveURL(`/operators/${publicSlugs.get(withModules.id)}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(displayName(withModules));

    const tabs = page.getByRole("tablist", { name: `Secciones de ${displayName(withModules)}` });
    await expect(tabs.getByRole("tab", { name: "Estadísticas" })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".operator-stats-content")).toBeVisible();

    await tabs.getByRole("tab", { name: "Habilidades" }).click();
    await expect(page.locator(".operator-skill-card").first()).toBeVisible();

    await tabs.getByRole("tab", { name: "Módulos" }).click();
    await expect(page.locator(".operator-module-card").first()).toBeVisible();

    await tabs.getByRole("tab", { name: "Expediente" }).click();
    await expect(page.locator(".operator-record-content h3")).not.toHaveText("");

    await tabs.getByRole("tab", { name: "Expediente" }).press("Home");
    await expect(tabs.getByRole("tab", { name: "Estadísticas" })).toHaveAttribute("aria-selected", "true");
    await expect(tabs.getByRole("tab", { name: "Estadísticas" })).toBeFocused();
  });

  test("el interruptor de módulos CN muestra los módulos aún no publicados en Global", async ({ page }) => {
    test.skip(!withCnModule, "ningún operador Global tiene módulos solo de CN");
    const modules = readModules(withCnModule!.id);
    await page.goto(`/operators/${publicSlugs.get(withCnModule!.id)}`);
    await page.getByRole("tab", { name: "Módulos" }).click();
    const cards = page.locator(".operator-module-card");
    await expect(cards).toHaveCount(modules.filter((module) => module.region === "en").length);
    const toggle = page.getByRole("button", { name: "Incluir módulos CN" });
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(cards).toHaveCount(modules.length);
  });

  test("una ficha exclusiva CN muestra su biografía CN", async ({ page }) => {
    test.skip(!cnOnly, "el catálogo no tiene exclusivos CN");
    await page.goto(`/operators/${publicSlugs.get(cnOnly!.id)}`);
    await page.getByRole("tab", { name: "Expediente" }).click();
    await expect(page.locator(".operator-detail-status")).toContainText("CN");
    expect(await page.locator(".operator-record-content").innerText()).toMatch(/[㐀-鿿]/u);
  });
});

test.describe("rutas de fichas", () => {
  test("redirige con 308 los slugs internos y anteriores al slug público", async ({ request }) => {
    const operator = globalOperators[0]!;
    const internal = await request.get(`/operators/${operator.slug}`, { maxRedirects: 0 });
    expect(internal.status()).toBe(308);
    expect(internal.headers().location).toBe(`/operators/${publicSlugs.get(operator.id)}`);

    test.skip(!renamed, "ningún operador tiene slugs anteriores");
    for (const slug of renamed!.previousSlugs) {
      const response = await request.get(`/operators/${slug}`, { maxRedirects: 0 });
      expect(response.status()).toBe(308);
      expect(response.headers().location).toBe(`/operators/${publicSlugs.get(renamed!.id)}`);
    }
  });

  test("devuelve 404 para un operador inexistente", async ({ page, diagnostics }) => {
    const response = await page.goto("/operators/operador-que-no-existe");
    expect(response?.status()).toBe(404);
    // The 404 document itself is reported as a failed resource.
    diagnostics.consoleErrors.splice(0);
  });
});
