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

/**
 * Operator of a slug: its public slug, the internal `operator-char-…` slug or a previous public slug (`previousSlugs`
 * maps each one to its operator id). `redirect` is set when the slug is not the current public one.
 */
export function resolveOperatorSlug(slug: string, records: readonly OperatorRecord[], previousSlugs: ReadonlyMap<string, string>): { operator: OperatorRecord; publicSlug: string; redirect: boolean } | null {
  const publicSlugs = getOperatorPublicSlugs(records);
  const previousId = previousSlugs.get(slug);
  const operator = records.find((record) => publicSlugs.get(record.id) === slug) ?? records.find((record) => record.slug === slug || record.id === previousId);
  if (!operator) return null;
  const publicSlug = publicSlugs.get(operator.id)!;
  return { operator, publicSlug, redirect: publicSlug !== slug };
}

/** Document title of an operator page, before the site template. */
export function getOperatorPageTitle(operator: Pick<OperatorRecord, "name" | "globalName">): string {
  return `${operator.globalName || operator.name}: habilidades, módulos y estadísticas`;
}
