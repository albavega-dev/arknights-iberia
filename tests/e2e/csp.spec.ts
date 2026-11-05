import { readFileSync } from "node:fs";
import path from "node:path";

import type { Page } from "@playwright/test";

import { displayName, expect, expectHydrated, openCatalog, publicSlugs, readModules, records, test } from "./support";

const header = "content-security-policy";
const hasGlossaryTerms = (operatorId: string) => readFileSync(path.join(process.cwd(), "data", "operator-skills", `${operatorId}.json`), "utf8").includes("<$");
const operator = records.find((record) => !record.cnOnly && readModules(record.id).some((module) => module.region === "en") && hasGlossaryTerms(record.id))!;

/**
 * Collects every browser message about the policy, at any level (violations, ignored or invalid directives), and every
 * document served without it or with the toolbar sources of preview deployments. The shared fixture also turns
 * violations into console errors in every test.
 */
function watchPolicy(page: Page): string[] {
  const messages: string[] = [];
  page.on("console", (message) => {
    if (/content security policy/i.test(message.text())) messages.push(`${message.type()}: ${message.text()}`);
  });
  page.on("response", (response) => {
    if (response.request().resourceType() !== "document") return;
    const policy = response.headers()[header];
    if (!policy) messages.push(`missing ${header}: ${response.url()}`);
    else if (policy.includes("vercel")) messages.push(`preview sources in ${header}: ${response.url()}`);
  });
  return messages;
}

test.describe("política de seguridad de contenido", () => {
  test("la portada, el catálogo en sus dos vistas y los créditos no la infringen", async ({ page }) => {
    const messages = watchPolicy(page);
    await page.goto("/");
    await expectHydrated(page, "site");
    await openCatalog(page);
    const views = page.getByRole("group", { name: "Vista de la biblioteca" });
    await views.getByRole("button", { name: "Vista de avatares" }).click();
    await expect(page).toHaveURL(/[?&]view=avatars/);
    await views.getByRole("button", { name: "Vista de retratos" }).click();
    await expect(page).not.toHaveURL(/[?&]view=avatars/);
    await page.goto("/credits");
    await expectHydrated(page, "site");
    expect(messages).toEqual([]);
  });

  test("una ficha con todas sus pestañas, el glosario y la ilustración ampliada no la infringe", async ({ page }) => {
    const messages = watchPolicy(page);
    await page.goto(`/operators/${publicSlugs.get(operator.id)}`);
    await expectHydrated(page, "site");
    const tabs = page.getByRole("tablist", { name: `Secciones de ${displayName(operator)}` });
    await tabs.getByRole("tab", { name: "Habilidades" }).click();
    await page.locator("button.is-term").first().click();
    await expect(page.locator(".operator-glossary-panel")).toBeVisible();
    await page.keyboard.press("Escape");
    for (const name of ["Módulos", "Expediente", "Estadísticas"]) {
      await tabs.getByRole("tab", { name }).click();
      await expect(tabs.getByRole("tab", { name })).toHaveAttribute("aria-selected", "true");
    }
    await page.getByRole("button", { name: /^Ampliar ilustración/ }).first().click();
    const dialog = page.getByRole("dialog", { name: /^Ilustración/ });
    await expect(dialog).toBeVisible();
    await expect.poll(() => dialog.getByRole("img").evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    expect(messages).toEqual([]);
  });

  test("las páginas 404 no la infringen", async ({ page, diagnostics }) => {
    const messages = watchPolicy(page);
    for (const url of ["/pagina-que-no-existe", "/operators/operador-que-no-existe"]) {
      const response = await page.goto(url);
      expect(response?.status()).toBe(404);
      await expectHydrated(page, "site");
    }
    // The 404 documents themselves are reported as failed resources.
    const notFound = diagnostics.consoleErrors.filter((message) => /404/.test(message));
    expect(notFound).toHaveLength(diagnostics.consoleErrors.length);
    diagnostics.consoleErrors.splice(0);
    expect(messages).toEqual([]);
  });
});
