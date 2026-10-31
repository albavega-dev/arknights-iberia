import "server-only";

import catalogData from "../../data/operator-catalog/index.json";
import type { OperatorRecord } from "./operators";
import { catalogOperatorRecord, validateOperatorCatalog, type CatalogOperator, type OperatorCatalog } from "./operator-catalog";

const catalog = catalogData as unknown as OperatorCatalog;
const records: readonly OperatorRecord[] = catalog.operators.map(catalogOperatorRecord);

// Every operator of the catalog, ordered by id. The bundler includes the catalog file
// (data/operator-catalog/index.json) in the server output.
export function listCatalogOperators(): readonly CatalogOperator[] { return catalog.operators; }

/** Operator records of the catalog, ordered by id. */
export function listOperatorRecords(): readonly OperatorRecord[] { return records; }

const previousSlugs: ReadonlyMap<string, string> = new Map(catalog.operators.flatMap((operator) => operator.previousSlugs.map((slug) => [slug, operator.id] as const)));

/** Previous public slugs of the catalog, each with the id of its operator. */
export function listPreviousSlugs(): ReadonlyMap<string, string> { return previousSlugs; }

export function catalogErrors(): string[] { return validateOperatorCatalog(catalog); }
