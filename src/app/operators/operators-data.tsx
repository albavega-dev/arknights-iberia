import { connection } from "next/server";

import { listOperatorRecords } from "../../game-data/operator-catalog-data";
import { getNewOperatorIdsLenient } from "../../game-data/operator-global-updates";
import { OperatorCatalog } from "./operator-catalog";

export async function OperatorsData() {
  await connection();
  const records = listOperatorRecords();
  return <OperatorCatalog records={records} newOperatorIds={[...getNewOperatorIdsLenient(records)]} />;
}
