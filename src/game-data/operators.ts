export type OperatorClass =
  | "Guard"
  | "Vanguard"
  | "Defender"
  | "Sniper"
  | "Caster"
  | "Medic"
  | "Supporter"
  | "Specialist";

export type OperatorRecord = Readonly<{
  id: string;
  name: string;
  cnName?: string | null;
  globalName?: string | null;
  class: OperatorClass;
  subClassId: string | null;
  rarity: 1 | 2 | 3 | 4 | 5 | 6;
  slug: string;
  cnOnly: boolean;
  availabilityStatus: "global-snapshot" | "cn-snapshot-candidate";
  cnReleaseDate: string | null;
  cnReleaseDateStatus?: "verified" | "community-listed" | null;
  cnReleaseDateSource?: string | null;
  globalReleaseDate: string | null;
  mainPowerNationId: string | null;
  mainPowerGroupId: string | null;
  mainPowerTeamId: string | null;
  mainFactionId: string | null;
  hasSubPower?: boolean;
  additionalFactionIds?: readonly string[];
}>;

export type OperatorFilters = Readonly<{
  query: string;
  className: OperatorClass | null;
  subClassIds: readonly string[];
  rarities: readonly (1 | 2 | 3 | 4 | 5 | 6)[];
  includeCnOnly: boolean;
  mainFactionId: string | "all";
}>;

export type OperatorSortKey = "name" | "rarity" | "cnReleaseDate";
export type OperatorSortDirection = "asc" | "desc";

export function getOperatorDisplayName(operator: Pick<OperatorRecord, "name" | "cnName" | "globalName">): string {
  return operator.globalName || operator.name || operator.cnName || "";
}

function compareNullableDate(a: string | null, b: string | null, direction: OperatorSortDirection): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return direction === "asc" ? a.localeCompare(b) : b.localeCompare(a);
}

export function sortOperators(
  records: readonly OperatorRecord[],
  key: OperatorSortKey,
  direction: OperatorSortDirection,
  prioritizeCnOnly = false,
  prioritizeUnknownDates = false,
): OperatorRecord[] {
  return [...records].sort((a, b) => {
    if (key === "cnReleaseDate") {
      if (prioritizeCnOnly && a.cnOnly !== b.cnOnly) return a.cnOnly ? -1 : 1;
      const dateDifference = prioritizeUnknownDates
        ? a.cnReleaseDate === null && b.cnReleaseDate !== null
          ? -1
          : a.cnReleaseDate !== null && b.cnReleaseDate === null
            ? 1
            : compareNullableDate(a.cnReleaseDate, b.cnReleaseDate, direction)
        : compareNullableDate(a.cnReleaseDate, b.cnReleaseDate, direction);
      if (dateDifference !== 0) return dateDifference;
      const rarityDifference = b.rarity - a.rarity;
      if (rarityDifference !== 0) return rarityDifference;
      return getOperatorDisplayName(a).localeCompare(getOperatorDisplayName(b), "en") || a.id.localeCompare(b.id, "en");
    }
    const primary =
      key === "name" ? getOperatorDisplayName(a).localeCompare(getOperatorDisplayName(b), "en") : a.rarity - b.rarity;
    const directed = direction === "asc" ? primary : -primary;
    if (directed !== 0) return directed;
    if (key === "rarity") {
      const dateDifference = compareNullableDate(a.cnReleaseDate, b.cnReleaseDate, "desc");
      if (dateDifference !== 0) return dateDifference;
      const nameDifference = getOperatorDisplayName(a).localeCompare(getOperatorDisplayName(b), "en");
      if (nameDifference !== 0) return nameDifference;
    }
    return a.id.localeCompare(b.id, "en");
  });
}

export function filterOperators(records: readonly OperatorRecord[], filters: OperatorFilters): OperatorRecord[] {
  const query = filters.query.trim().toLocaleLowerCase("en");
  return records.filter(
    (operator) =>
      [operator.name, operator.cnName, operator.globalName]
        .filter((name): name is string => Boolean(name))
        .some((name) => name.toLocaleLowerCase("en").includes(query)) &&
      (!filters.className || operator.class === filters.className) &&
      (!filters.subClassIds.length ||
        (operator.subClassId !== null && filters.subClassIds.includes(operator.subClassId))) &&
      (!filters.rarities.length || filters.rarities.includes(operator.rarity)) &&
      (filters.includeCnOnly || !operator.cnOnly) &&
      (filters.mainFactionId === "all" ||
        operator.mainFactionId === filters.mainFactionId ||
        operator.additionalFactionIds?.includes(filters.mainFactionId) === true),
  );
}
