import { expect, openCatalog, test } from "./support";

const forbiddenSecretPattern = /(postgres(?:ql)?:\/\/|password\s*=|APP_DB_PASSWORD|MIGRATION_DB_PASSWORD|DATABASE_URL)/i;

test.describe("estado del servicio", () => {
  test("/api/health y /api/ready responden 200 sin caché", async ({ request }) => {
    const health = await request.get("/api/health");
    expect(health.status()).toBe(200);
    const ready = await request.get("/api/ready");
    expect(ready.status()).toBe(200);
    expect(await ready.json()).toEqual({ status: "ok" });
    expect(ready.headers()["cache-control"]).toContain("no-store");
  });

  test("la portada y el catálogo cargan sin desbordamiento horizontal ni secretos en el HTML", async ({ page }) => {
    const documents: Promise<string>[] = [];
    page.on("response", (response) => {
      if (response.request().resourceType() === "document") documents.push(response.text());
    });
    await page.goto("/");
    await expect(page.locator("main")).toBeVisible();
    await openCatalog(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    for (const html of await Promise.all(documents)) expect(html).not.toMatch(forbiddenSecretPattern);
  });
});
