import { getOperatorPublicSlugs } from "../../../game-data/operator-slugs";
import type { OperatorRecord } from "../../../game-data/operators";
import type { BiographyReadResult } from "../../../game-data/operator-biography";

export type OperatorDetailBiographyResult =
  | { readonly status: "operator-not-found" }
  | { readonly status: "operator-found"; readonly operator: OperatorRecord; readonly biography: BiographyReadResult };

export async function loadOperatorDetailBiography(
  slug: string,
  records: readonly OperatorRecord[],
  readBiography: (operatorId: string, region: "en" | "cn") => Promise<BiographyReadResult>,
): Promise<OperatorDetailBiographyResult> {
  const publicSlugs = getOperatorPublicSlugs(records);
  const operator = records.find((record) => record.slug === slug || publicSlugs.get(record.id) === slug);
  if (!operator) return { status: "operator-not-found" };
  const biography = await readBiography(operator.id, operator.cnOnly ? "cn" : "en");
  return { status: "operator-found", operator, biography };
}
