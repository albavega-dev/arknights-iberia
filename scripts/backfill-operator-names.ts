import { compareCodeUnits } from "../src/game-data/string-order";
import { normalizeCharacterTable } from "../src/game-data/operator-import";

type CurrentRow = { id: string; name: string; slug: string; cn_only: boolean; availability_status: string; cn_name: string | null; global_name: string | null };
type RegionalManifest = { comparison?: { cn?: { revision?: string } }; operators: Array<{ id: string; nameEnglish: string | null }> };
type Proposal = { id: string; cnName: string | null; globalName: string | null };

export function buildNameProposals(enSource: unknown, cnSource: unknown, regionalManifest: RegionalManifest): Proposal[] {
  const global = new Map(normalizeCharacterTable(enSource).operators.map((operator) => [operator.id, operator.name]));
  const cn = new Map(normalizeCharacterTable(cnSource).operators.map((operator) => [operator.id, operator.name]));
  const regionalIds = new Set(regionalManifest.operators.map((operator) => operator.id));
  if (cn.size !== global.size + regionalIds.size || [...global.keys()].some((id) => !cn.has(id)) || [...regionalIds].some((id) => global.has(id))) throw new Error("Invalid regional name proposals");
  return [...cn.keys()].sort(compareCodeUnits).map((id) => ({ id, cnName: cn.get(id) ?? null, globalName: global.get(id) ?? null }));
}

export function validateNameBackfill(current: readonly CurrentRow[], proposals: readonly Proposal[], regionalManifest?: RegionalManifest): void {
  const proposalIds = new Set(proposals.map((proposal) => proposal.id));
  const knownLegacy = new Map((regionalManifest?.operators ?? []).map((operator) => [operator.id, operator.nameEnglish]));
  if (proposals.length === 0 || proposalIds.size !== proposals.length) throw new Error("Expected unique name proposals");
  if (current.length !== proposals.length || new Set(current.map((row) => row.id)).size !== proposals.length) throw new Error(`Expected ${proposals.length} unique operators`);
  for (const row of current) {
    const proposal = proposals.find((candidate) => candidate.id === row.id);
    if (!proposal) throw new Error(`Missing proposal for ${row.id}`);
    if (row.cn_name !== null && row.cn_name !== proposal.cnName && row.cn_name !== knownLegacy.get(row.id)) throw new Error(`Existing cn_name conflict for ${row.id}`);
    if (row.global_name !== null && row.global_name !== proposal.globalName) throw new Error(`Existing global_name conflict for ${row.id}`);
  }
}

export function validateKnownLegacyCnNames(current: readonly CurrentRow[], regionalManifest: RegionalManifest): void {
  const expected = new Map(regionalManifest.operators.map((operator) => [operator.id, operator.nameEnglish]));
  for (const row of current) {
    const legacy = expected.get(row.id);
    if (legacy !== undefined && row.cn_name !== null && row.cn_name !== legacy) throw new Error(`Unexpected existing cn_name conflict for ${row.id}`);
    if (legacy === undefined && row.cn_name !== null && row.cn_name.length === 0) throw new Error(`Unexpected empty cn_name for ${row.id}`);
  }
}
