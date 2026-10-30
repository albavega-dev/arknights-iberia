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

export function catalogErrors(): string[] { return validateOperatorCatalog(catalog); }
