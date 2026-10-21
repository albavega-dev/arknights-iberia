import { test, expect } from "@playwright/test";

const forbiddenSecretPattern = /(postgres(?:ql)?:\/\/|password\s*=|APP_DB_PASSWORD|MIGRATION_DB_PASSWORD|DATABASE_URL)/i;

function installDiagnostics(page: import("@playwright/test").Page) {
  const consoleErrors: string[] = [];
  const serverErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 500) serverErrors.push(`${response.status()} ${new URL(response.url()).pathname}`);
  });
  return { consoleErrors, serverErrors };
}

async function assertNoDiagnostics(diagnostics: { consoleErrors: string[]; serverErrors: string[] }) {
  expect(diagnostics.consoleErrors, "console errors").toEqual([]);
  expect(diagnostics.serverErrors, "server errors").toEqual([]);
}

test.describe("catálogo y biografías de operadores", () => {
  test("muestra catálogo y una ficha Global con biografía EN", async ({ page }) => {
    const diagnostics = installDiagnostics(page);
    await page.goto("/operators", { waitUntil: "networkidle" });
    await expect(page.locator("a[href^='/operators/']").first()).toBeVisible();
    await page.goto("/operators/amiya", { waitUntil: "networkidle" });
    await page.getByRole("tab", { name: "Expediente" }).click();
    await expect(page.locator(".operator-record-content")).toBeVisible();
    await expect(page.locator(".operator-record-content h3")).not.toHaveText("");
    await assertNoDiagnostics(diagnostics);
  });

  test("muestra una ficha CN-only con biografía CN y caracteres chinos", async ({ page }) => {
    const diagnostics = installDiagnostics(page);
    await page.goto("/operators/operator-char-1015-aglna2", { waitUntil: "networkidle" });
    await page.getByRole("tab", { name: "Expediente" }).click();
    await expect(page.locator(".operator-detail-status")).toContainText("CN");
    const content = await page.locator(".operator-record-content").innerText();
    expect(content).toMatch(/[\u3400-\u9fff]/u);
    await assertNoDiagnostics(diagnostics);
  });

  test("mantiene navegación responsive y no expone secretos en respuestas HTML", async ({ page }) => {
    const diagnostics = installDiagnostics(page);
    const responses: string[] = [];
    page.on("response", async (response) => {
      const type = response.headers()["content-type"] ?? "";
      if (type.includes("text/html")) responses.push(await response.text());
    });
    await page.goto("/operators", { waitUntil: "networkidle" });
    await expect(page.locator("main")).toBeVisible();
    for (const html of responses) expect(html).not.toMatch(forbiddenSecretPattern);
    await assertNoDiagnostics(diagnostics);
  });
});
