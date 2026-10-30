import { getOperatorDisplayName, type OperatorRecord } from "./operators";

const reservedSlugs = new Set(["new", "api", "index", "search"]);

export function normalizeOperatorSlugPart(name: string): string {
  return name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("en").split(/[^a-z0-9]+/).filter(Boolean).join("-") || "operator";
}

export function getOperatorPublicSlugs(records: readonly OperatorRecord[]): ReadonlyMap<string, string> {
  const groups = new Map<string, OperatorRecord[]>();
  for (const operator of records) {
    const base = normalizeOperatorSlugPart(getOperatorDisplayName(operator));
    groups.set(base, [...(groups.get(base) ?? []), operator]);
  }
  const result = new Map<string, string>();
  for (const [base, group] of groups) {
    [...group].sort((a, b) => a.id.localeCompare(b.id, "en")).forEach((operator, index) => {
      const needsSuffix = reservedSlugs.has(base) || group.length > 1;
      result.set(operator.id, needsSuffix ? `${base}-${index === 0 ? "" : `${index + 1}-`}${normalizeOperatorSlugPart(operator.id)}`.replace("--", "-") : base);
    });
  }
  return result;
}

export function getOperatorPublicSlug(operator: OperatorRecord, records: readonly OperatorRecord[]): string {
  return getOperatorPublicSlugs(records).get(operator.id) ?? normalizeOperatorSlugPart(getOperatorDisplayName(operator));
}

export function getOperatorPageTitle(operator: Pick<OperatorRecord, "name" | "globalName">): string {
  return `Operador - ${operator.globalName || operator.name}`;
}
