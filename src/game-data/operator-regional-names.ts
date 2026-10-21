import type { NormalizedOperator } from "./operator-import";

export type RegionalNameEntry = { id: string; nameEnglish?: string | null };

export function applyRegionalDisplayNames(
  operators: readonly NormalizedOperator[],
  regionalEntries: readonly RegionalNameEntry[],
): NormalizedOperator[] {
  const names = new Map(regionalEntries.map((entry) => [entry.id, entry.nameEnglish ?? null]));
  return operators.map((operator) => {
    const nameEnglish = operator.cnOnly ? names.get(operator.id) : undefined;
    if (operator.cnOnly && !nameEnglish) throw new Error(`Missing community-listed English name for ${operator.id}`);
    return nameEnglish ? { ...operator, name: nameEnglish } : operator;
  });
}
