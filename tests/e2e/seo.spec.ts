import { expect, test } from "./support";

test.describe("SEO y cabeceras de seguridad", () => {
  test("las respuestas llevan las cabeceras de seguridad y no revelan el framework", async ({ request }) => {
    for (const path of ["/", "/operators/amiya", "/api/health"]) {
      const headers = (await request.get(path)).headers();
      expect(headers["x-content-type-options"], path).toBe("nosniff");
      expect(headers["x-frame-options"], path).toBe("DENY");
      expect(headers["referrer-policy"], path).toBe("strict-origin-when-cross-origin");
      expect(headers["permissions-policy"], path).toContain("camera=()");
      expect(headers["x-powered-by"], path).toBeUndefined();
    }
  });

  test("robots.txt deniega el entrenamiento de IA y la API, y apunta al mapa del sitio", async ({ request }) => {
    const body = await (await request.get("/robots.txt")).text();
    expect(body).toMatch(/User-Agent: \*\s+Allow: \/\s+Disallow: \/api\//i);
    expect(body).toMatch(/User-Agent: GPTBot[\s\S]*Disallow: \/\n/i);
    expect(body).not.toMatch(/User-Agent: (Googlebot|ChatGPT-User|Claude-User|Discordbot)/i);
    expect(body).toMatch(/Sitemap: https?:\/\/[^\s]+\/sitemap\.xml/);
  });

  test("el mapa del sitio lista las páginas y las fichas con URL absolutas", async ({ request }) => {
    const body = await (await request.get("/sitemap.xml")).text();
    const locations = [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
    expect(locations.length).toBeGreaterThan(400);
    expect(locations.every((url) => /^https?:\/\//.test(url))).toBe(true);
    expect(locations.some((url) => url.endsWith("/operators/amiya"))).toBe(true);
    expect(new Set(locations).size).toBe(locations.length);
  });

  test("la ficha tiene título, descripción, canónica y vista previa propios, con un JPEG como imagen", async ({ page, request }) => {
    await page.goto("/operators/amiya");
    await expect(page).toHaveTitle("Amiya: habilidades, módulos y estadísticas | Arknights Iberia");
    const meta = (selector: string, attribute = "content") => page.locator(selector).first().getAttribute(attribute);
    expect(await meta('meta[name="description"]')).toContain("Amiya");
    expect(await meta('link[rel="canonical"]', "href")).toMatch(/\/operators\/amiya$/);
    expect(await meta('meta[name="twitter:card"]')).toBe("summary_large_image");
    const image = await meta('meta[property="og:image"]');
    expect(image).toMatch(/\/assets\/operator-og-images\/char_002_amiya\.jpg$/);
    const response = await request.get(new URL(image!).pathname);
    expect(response.headers()["content-type"]).toBe("image/jpeg");
  });
});
