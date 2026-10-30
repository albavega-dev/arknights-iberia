import { connection } from "next/server";

import { listOperatorRecords } from "../../game-data/operator-catalog-data";
import { OperatorCatalog } from "./operator-catalog";

export async function OperatorsData() {
  await connection();
  return <OperatorCatalog records={listOperatorRecords()} />;
}
