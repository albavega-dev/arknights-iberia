import "server-only";

import limitedManifest from "../../data/operator-limited-manifest.json";

const limitedIds: ReadonlySet<string> = new Set(limitedManifest.operators.map((operator) => operator.id));

export function isOperatorLimited(operatorId: string): boolean {
  return limitedIds.has(operatorId);
}
