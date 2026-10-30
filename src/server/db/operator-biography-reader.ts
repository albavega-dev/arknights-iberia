import { fixedBiographyRevisions, type BiographyReadResult, type BiographyRegion, type HandbookSource, type OperatorBiography } from "../../game-data/operator-biography";

export type { BiographyReadResult };

export type BiographyReadQueryResult = {
  readonly rows: readonly Record<string, unknown>[];
};

export type BiographyReadClient = {
  readonly query: (text: string, values: readonly unknown[]) => Promise<BiographyReadQueryResult>;
};

export function mapDrizzleBiographyRow(row: Record<string, unknown>): Record<string, unknown> {
  return {
    operator_id: row.operatorId,
    region: row.region,
    source_repository: row.sourceRepository,
    source_revision: row.sourceRevision,
    source_path: row.sourcePath,
    source_sha256: row.sourceSha256,
    story_title: row.storyTitle,
    original_text: row.originalText,
    fields: row.fields,
    unrecognized_lines: row.unrecognizedLines,
    profile_story_title: row.profileStoryTitle,
    profile_text: row.profileText,
  };
}

function mapBiography(row: Record<string, unknown>): OperatorBiography {
  return {
    operatorId: String(row.operator_id),
    region: row.region as BiographyRegion,
    storyTitle: String(row.story_title),
    source: {
      repository: String(row.source_repository),
      revision: String(row.source_revision),
      path: String(row.source_path),
      sha256: String(row.source_sha256),
    } satisfies HandbookSource,
    fields: row.fields as OperatorBiography["fields"],
    originalText: String(row.original_text),
    unrecognizedLines: row.unrecognized_lines as readonly string[],
    profile: row.profile_text === null || row.profile_text === undefined ? null : { storyTitle: String(row.profile_story_title), text: String(row.profile_text) },
  };
}

export async function readBiographyByOperatorId(
  client: BiographyReadClient,
  operatorId: string,
  region: BiographyRegion,
  revisions: Readonly<Record<BiographyRegion, string>> = fixedBiographyRevisions,
): Promise<BiographyReadResult> {
  const revision = revisions[region];
  const result = await client.query(
    "SELECT operator_id, region, source_repository, source_revision, source_path, source_sha256, story_title, original_text, fields, unrecognized_lines, profile_story_title, profile_text FROM operator_biographies WHERE operator_id = $1 AND region = $2 AND source_revision = $3 LIMIT 1",
    [operatorId, region, revision],
  );
  const row = result.rows[0];
  return row ? { status: "found", biography: mapBiography(row) } : { status: "not-found", operatorId, region, revision };
}
