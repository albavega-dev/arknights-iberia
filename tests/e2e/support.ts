import { readFileSync } from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";

import { test as base, expect, type Locator, type Page } from "@playwright/test";

import { catalogOperatorRecord, type OperatorCatalog } from "../../src/game-data/operator-catalog";
import type { GlobalUpdatesManifest } from "../../src/game-data/operator-global-updates";
import { getOperatorPublicSlugs } from "../../src/game-data/operator-slugs";
import { filterOperators, getOperatorDisplayName, type OperatorFilters, type OperatorRecord } from "../../src/game-data/operators";

// Expected values come from the versioned datasets, so the tests follow every data update. The files are read with
// fs because the test loader needs import attributes for JSON modules.
function readData<T>(relativePath: string): T {
  return JSON.parse(readFileSync(path.join(process.cwd(), "data", relativePath), "utf8")) as T;
}

const catalog = readData<OperatorCatalog>("operator-catalog/index.json");
export const catalogOperators = catalog.operators;
export const records: readonly OperatorRecord[] = catalog.operators.map(catalogOperatorRecord);
export const publicSlugs = getOperatorPublicSlugs(records);

/** Global operators of the latest Global update already opened. */
export const newOperatorIds: ReadonlySet<string> = (() => {
  const opened = readData<GlobalUpdatesManifest>("operator-global-updates.json").updates.filter((update) => Date.parse(update.opensAt) <= Date.now());
  const latest = opened.sort((a, b) => Date.parse(a.opensAt) - Date.parse(b.opensAt)).at(-1);
  const globalIds = new Set(records.filter((operator) => !operator.cnOnly).map((operator) => operator.id));
  return new Set((latest?.operatorIds ?? []).filter((id) => globalIds.has(id)));
})();

const defaultFilters: OperatorFilters = { query: "", className: null, subClassIds: [], rarities: [], includeCnOnly: false, mainFactionId: "all" };

export function expectedCount(filters: Partial<OperatorFilters>): number {
  return filterOperators(records, { ...defaultFilters, ...filters }).length;
}

export function displayName(operator: OperatorRecord): string {
  return getOperatorDisplayName(operator);
}

/** Display names that no other operator contains, so a search for them returns a single card. */
export function uniquelySearchable(operator: OperatorRecord): boolean {
  return expectedCount({ query: displayName(operator), includeCnOnly: true }) === 1;
}

type ModuleFile = { modules: Array<{ region: "en" | "cn" }> };

export function readModules(operatorId: string): ModuleFile["modules"] {
  try {
    return readData<ModuleFile>(`operator-modules/${operatorId}.json`).modules;
  } catch {
    return [];
  }
}

function crc32(bytes: Buffer): number {
  let crc = ~0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** 1×1 transparent PNG served instead of every optimized or remote image. */
const placeholderPng = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  pngChunk("IHDR", Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0])),
  pngChunk("IDAT", deflateSync(Buffer.from([0, 0, 0, 0, 0]))),
  pngChunk("IEND", Buffer.alloc(0)),
]);

type Diagnostics = { consoleErrors: string[]; serverErrors: string[]; missingFiles: string[]; blockedRequests: string[]; optimizerRequests: string[] };

/**
 * Only the local server is reachable: every image is a local file, so any external request (images included) is aborted
 * and reported, a missing local file is reported, and any `/_next/image` request fails the test.
 */
export const test = base.extend<{ diagnostics: Diagnostics }>({
  diagnostics: [async ({ page, baseURL }, provide) => {
    const origin = new URL(baseURL!).origin;
    const diagnostics: Diagnostics = { consoleErrors: [], serverErrors: [], missingFiles: [], blockedRequests: [], optimizerRequests: [] };
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === origin && url.pathname === "/_next/image") {
        diagnostics.optimizerRequests.push(url.href);
        return route.fulfill({ status: 200, contentType: "image/png", body: placeholderPng });
      }
      if (url.origin === origin) return route.continue();
      diagnostics.blockedRequests.push(url.href);
      return route.abort("blockedbyclient");
    });
    page.on("console", (message) => {
      if (message.type() === "error") diagnostics.consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => diagnostics.consoleErrors.push(error.message));
    page.on("response", (response) => {
      if (response.status() >= 500) diagnostics.serverErrors.push(`${response.status()} ${new URL(response.url()).pathname}`);
      else if (response.status() >= 400 && new URL(response.url()).pathname.startsWith("/assets/")) diagnostics.missingFiles.push(`${response.status()} ${new URL(response.url()).pathname}`);
    });
    await provide(diagnostics);
    expect(diagnostics.consoleErrors, "console errors").toEqual([]);
    expect(diagnostics.serverErrors, "server errors").toEqual([]);
    expect(diagnostics.missingFiles, "missing local files").toEqual([]);
    expect(diagnostics.blockedRequests, "external requests").toEqual([]);
    expect(diagnostics.optimizerRequests, "image optimizer requests").toEqual([]);
  }, { auto: true }],
});

export { expect };

export function operatorCards(page: Page): Locator {
  return page.getByRole("region", { name: "Operadores filtrados" }).locator("a.operator-card");
}

export async function openCatalog(page: Page, query = ""): Promise<void> {
  await page.goto(`/operators${query}`);
  await expect(operatorCards(page).first()).toBeVisible();
}
