import { readFileSync } from "node:fs";
import path from "node:path";

import type { Locator } from "@playwright/test";

import { expect, expectHydrated, openCatalog, operatorCards, publicSlugs, records, test } from "./support";

// Every image is a local copy under /assets; the fixture of support.ts already fails on any external request.
const manifest = JSON.parse(readFileSync(path.join(process.cwd(), "data", "operator-image-manifest.json"), "utf8")) as { illustrations: Record<string, unknown> };
const withElite2 = records.find((operator) => !operator.cnOnly && operator.subClassId && `${operator.id}_2.webp` in manifest.illustrations)!;

/** Every image of the locator is a local file that the browser decoded. */
async function expectLocalImages(images: Locator, directory: string): Promise<void> {
  await expect(images.first()).toBeVisible();
  await expect.poll(() => images.evaluateAll((items, prefix) => items.map((item) => {
    const image = item as HTMLImageElement;
    const loaded = image.complete && image.naturalWidth > 0;
    // Images load lazily: one outside the viewport (frequent on mobile) only loads once it is scrolled into view.
    if (!loaded) image.scrollIntoView({ block: "nearest" });
    return new URL(image.currentSrc || image.src).pathname.startsWith(prefix) && loaded;
  }).every(Boolean), `/assets/${directory}/`)).toBe(true);
}

const illustrationPath = (variant: 1 | 2) => new RegExp(`/assets/operator-illustrations/${withElite2.id}_${variant}\\.webp$`);

test.describe("imágenes locales", () => {
  test("el catálogo muestra retratos, iconos de clase y subclase y logos de facción locales", async ({ page }) => {
    await openCatalog(page);
    await expectLocalImages(operatorCards(page).locator("img.operator-card-portrait").first(), "operator-portraits");
    await expectLocalImages(operatorCards(page).locator(".operator-card-class-icon img").first(), "operator-classes");
    await expectLocalImages(page.getByRole("group", { name: "Clase" }).locator("img"), "operator-classes");

    await page.getByRole("button", { name: "Guard", exact: true }).click();
    await expectLocalImages(page.getByRole("group", { name: "Arquetipo · Guard" }).locator("img"), "operator-subclasses");

    await page.locator("#operator-faction").click();
    await expectLocalImages(page.getByRole("listbox").locator("img"), "operator-factions");
  });

  test("la ficha muestra la ilustración E0 y la E2 locales", async ({ page }) => {
    await page.goto(`/operators/${publicSlugs.get(withElite2.id)}`);
    const illustration = page.locator("img.operator-detail-illustration");
    await expectLocalImages(illustration, "operator-illustrations");
    await expect(illustration).toHaveAttribute("src", illustrationPath(1));

    await expectHydrated(page, "site");
    await page.getByRole("button", { name: "E2", exact: true }).click();
    const elite2 = page.locator("img.operator-detail-illustration.is-elite2");
    await expectLocalImages(elite2, "operator-illustrations");
    await expect(elite2).toHaveAttribute("src", illustrationPath(2));
  });
});
