import type { Page } from "@playwright/test";
import type { LimitedManifest } from "../../src/game-data/operator-limited";
import { displayName, expect, expectedCount, newOperatorIds, openCatalog, publicSlugs, readData, records, test, transparentPng, uniquelySearchable } from "./support";

const globalOperators = records.filter((operator) => !operator.cnOnly);
const limitedIds = new Set(readData<LimitedManifest>("operator-limited-manifest.json").operators.map((operator) => operator.id));
const limited = globalOperators.find((operator) => limitedIds.has(operator.id))!;
const notLimited = globalOperators.find((operator) => !limitedIds.has(operator.id))!;
const avatars = (page: Page) => page.getByRole("region", { name: "Operadores filtrados" }).locator("a.operator-avatar");
const horizontalOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe("vista por avatares", () => {
  test("cambia de vista, conserva filtros y búsqueda, y la guarda en la URL", async ({ page }) => {
    const operator = globalOperators.find(uniquelySearchable)!;
    await openCatalog(page);
    const views = page.getByRole("group", { name: "Vista de la biblioteca" });
    await expect(views.getByRole("button", { name: "Vista de retratos" })).toHaveAttribute("aria-pressed", "true");
    await views.getByRole("button", { name: "Vista de avatares" }).click();
    await expect(page).toHaveURL(/[?&]view=avatars/);
    await expect(avatars(page)).toHaveCount(expectedCount({}));
    await expect(page.locator("a.operator-card")).toHaveCount(0);
    await expect(avatars(page).locator("img[src*='/assets/operator-avatars/']")).toHaveCount(expectedCount({}));

    await page.getByRole("searchbox", { name: "Buscar" }).fill(displayName(operator));
    await expect(avatars(page)).toHaveCount(1);
    await expect(avatars(page).first()).toHaveAccessibleName(new RegExp(`^${displayName(operator).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}, `));
    await expect(page).toHaveURL(/[?&]q=.*view=avatars|view=avatars.*[?&]q=/);
    await page.reload();
    await expect(avatars(page)).toHaveCount(1);
    await expect(page).toHaveURL(/view=avatars/);

    const controls = page.getByRole("search", { name: "Buscar y filtrar operadores" });
    await controls.getByRole("button", { name: "Restablecer filtros" }).click();
    await expect(avatars(page)).toHaveCount(expectedCount({}));
    await expect(page).toHaveURL(/\/operators\?view=avatars$/);
    await controls.getByRole("button", { name: operator.class, exact: true }).click();
    await expect(avatars(page)).toHaveCount(expectedCount({ className: operator.class }));
    await views.getByRole("button", { name: "Vista de retratos" }).click();
    await expect(page.locator("a.operator-card")).toHaveCount(expectedCount({ className: operator.class }));
    await expect(page).not.toHaveURL(/view=/);
  });

  test("solo muestra el avatar, la clase y el indicador; el nombre aparece al enfocar", async ({ page }) => {
    await page.goto("/operators?view=avatars&cn=1");
    await expect(avatars(page).first()).toBeVisible();
    const first = avatars(page).first();
    const name = first.locator(".operator-avatar-name");
    await expect(name).toBeHidden();
    await first.focus();
    await expect(name).toBeVisible();
    const box = await first.locator(".operator-avatar-art").boundingBox();
    const outline = await first.locator(".operator-avatar-art").evaluate((element) => getComputedStyle(element).outlineStyle);
    expect(outline).toBe("solid");
    expect(box!.width).toBeGreaterThan(50);
    expect(Math.abs(box!.width - box!.height)).toBeLessThan(1);
    await expect(page.locator("a.operator-avatar.is-new")).toHaveCount(newOperatorIds.size);
    await expect(page.locator("a.operator-avatar.is-upcoming")).toHaveCount(records.filter((operator) => operator.cnOnly).length);
    await expect(page.locator("a.operator-avatar .operator-card-new, a.operator-avatar .operator-card-upcoming")).toHaveCount(0);
    if (newOperatorIds.size) {
      const dot = await page.locator("a.operator-avatar.is-new .operator-avatar-badge").first().evaluate((element) => getComputedStyle(element));
      expect(dot.backgroundImage).toMatch(/^radial-gradient/);
      expect(dot.boxShadow).not.toMatch(/0px 0px 0px/);
    }

    const views = page.getByRole("group", { name: "Vista de la biblioteca" });
    const toggle = page.getByRole("button", { name: "Incluir exclusivos CN" });
    await expect(page.locator(".operators-rarity-line").getByRole("group", { name: "Vista de la biblioteca" })).toHaveCount(1);
    const [viewsBox, toggleBox] = [await views.boundingBox(), await toggle.boundingBox()];
    expect(Math.abs(viewsBox!.y + viewsBox!.height / 2 - (toggleBox!.y + toggleBox!.height / 2))).toBeLessThan(2);

    const rarity = (await first.getAttribute("class"))!.match(/rarity-\d/)![0];
    const avatarStrip = await first.locator(".operator-avatar-art").evaluate((element) => getComputedStyle(element, "::after").backgroundImage);
    await views.getByRole("button", { name: "Vista de retratos" }).click();
    const cardStrip = await page.locator(`a.operator-card.${rarity}`).first().evaluate((element) => getComputedStyle(element, "::before").backgroundImage);
    expect(avatarStrip).toBe(cardStrip);
    await views.getByRole("button", { name: "Vista de avatares" }).click();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });
});

test.describe("detalles de la ficha", () => {
  test("las estrellas de los operadores limitados brillan y respetan la reducción de movimiento", async ({ page }) => {
    await page.goto(`/operators/${publicSlugs.get(limited.id)}`);
    const rarity = page.getByLabel(`Rareza: ${limited.rarity} estrellas, operador limitado`);
    await expect(rarity).toHaveClass(/is-limited/);
    const sheen = rarity.locator(".operator-detail-rarity-sheen");
    await expect(sheen).toHaveCSS("animation-name", "operator-limited-star-sheen");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(sheen).toBeHidden();
    await page.goto(`/operators/${publicSlugs.get(notLimited.id)}`);
    await expect(page.getByLabel(`Rareza: ${notLimited.rarity} estrellas`, { exact: true })).not.toHaveClass(/is-limited/);
    await expect(page.locator(".operator-detail-rarity-sheen")).toHaveCount(0);
  });

  test("amplía la ilustración en un diálogo con la versión de 1280 px", async ({ page }) => {
    await page.goto(`/operators/${publicSlugs.get(limited.id)}`);
    const trigger = page.getByRole("button", { name: `Ampliar ilustración E0 / E1 de ${displayName(limited)}` });
    const dialog = page.getByRole("dialog", { name: `Ilustración E0 / E1 de ${displayName(limited)}` });

    await trigger.click();
    await expect(dialog).toBeVisible();
    const image = dialog.getByRole("img");
    await expect(image).toHaveAttribute("src", `/assets/operator-illustrations/${limited.id}_1.webp`);
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(1000);
    await expect(dialog.getByRole("button", { name: "Cerrar ilustración ampliada" })).toBeFocused();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();

    await trigger.click();
    await image.click();
    await expect(dialog).toBeVisible();
    await page.mouse.click(5, 5);
    await expect(dialog).toBeHidden();

    await trigger.click();
    await dialog.getByRole("button", { name: "Cerrar ilustración ampliada" }).click();
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("la ilustración ampliada cabe entera en la ventana con cualquier proporción y resolución", async ({ page }, testInfo) => {
    const viewports = testInfo.project.name === "mobile"
      ? [[390, 844], [844, 390], [320, 568], [568, 320]]
      : [[1920, 1080], [1366, 768], [1280, 600], [1024, 1366]];
    const shapes = [[600, 2400], [2400, 500], [1280, 1280]] as const;
    let shape: readonly [number, number] = shapes[0];
    await page.route(`**/assets/operator-illustrations/${limited.id}_1.webp`, (route) => route.fulfill({ status: 200, contentType: "image/png", headers: { "cache-control": "no-store" }, body: transparentPng(...shape) }));
    for (const current of shapes) {
      shape = current;
      await page.goto(`/operators/${publicSlugs.get(limited.id)}`);
      for (const [width, height] of viewports) {
        await page.setViewportSize({ width: width!, height: height! });
        await page.getByRole("button", { name: /^Ampliar ilustración/ }).click();
        const image = page.locator("dialog[open] img");
        await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth)).toBe(current[0]);
        const layout = await page.evaluate(() => {
          const box = (element: Element) => { const { left, top, right, bottom, width, height } = element.getBoundingClientRect(); return { left, top, right, bottom, width, height }; };
          const image = document.querySelector("dialog[open] img")!;
          const close = document.querySelector(".operator-art-dialog-close")!;
          const button = box(close);
          return { image: box(image), button, width: document.documentElement.clientWidth, height: window.innerHeight, onTop: Boolean(document.elementFromPoint(button.left + button.width / 2, button.top + button.height / 2)?.closest(".operator-art-dialog-close")) };
        });
        const where = `${current.join("×")} en ${width}×${height}`;
        expect(layout.image.left, where).toBeGreaterThanOrEqual(8);
        expect(layout.image.right, where).toBeLessThanOrEqual(layout.width - 8);
        expect(layout.image.top, where).toBeGreaterThanOrEqual(layout.button.bottom);
        expect(layout.image.bottom, where).toBeLessThanOrEqual(layout.height - 8);
        expect(Math.abs(layout.image.width / layout.image.height - current[0] / current[1]) / (current[0] / current[1]), where).toBeLessThan(0.02);
        expect(layout.button.top >= 0 && layout.button.right <= layout.width && layout.onTop, where).toBe(true);
        expect(await horizontalOverflow(page), where).toBeLessThanOrEqual(0);
        await page.keyboard.press("Escape");
        await expect(page.locator("dialog[open]")).toHaveCount(0);
      }
    }
  });

  test("los créditos listan el CDN de retratos entre los recursos gráficos", async ({ page }) => {
    await page.goto("/credits");
    const graphics = page.getByRole("region", { name: "Recursos gráficos" });
    await expect(graphics.getByRole("link", { name: "Arknights CDN" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Datos del juego" }).getByRole("link", { name: "Arknights CDN" })).toHaveCount(0);
  });
});
