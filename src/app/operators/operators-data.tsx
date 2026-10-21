import { connection } from "next/server";

import { listOperators } from "../../server/db/operator-repository";
import { OperatorCatalog } from "./operator-catalog";

export async function OperatorsData() {
  await connection();
  const records = await listOperators();
  return <OperatorCatalog records={records} />;
}
