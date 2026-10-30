import "server-only";

import catalogData from "../../data/operator-catalog/index.json";
import { validateOperatorCatalog, type CatalogOperator, type OperatorCatalog } from "./operator-catalog";

const catalog = catalogData as unknown as OperatorCatalog;

// Every operator of the catalog, ordered by id. The bundler includes the catalog file
// (data/operator-catalog/index.json) in the server output.
export function listCatalogOperators(): readonly CatalogOperator[] { return catalog.operators; }

export function catalogErrors(): string[] { return validateOperatorCatalog(catalog); }
