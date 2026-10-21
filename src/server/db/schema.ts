import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

// Technical-only migration smoke-test table. No product or personal data.
export const migrationProbe = pgTable("migration_probe", {
  id: integer("id").primaryKey(),
  note: text("note").notNull(),
});

export const operators = pgTable("operators", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  cnName: text("cn_name"),
  globalName: text("global_name"),
  className: text("class_name").notNull(),
  subClassId: text("sub_class_id"),
  rarity: integer("rarity").notNull(),
  slug: text("slug").notNull(),
  sourceLocale: text("source_locale").notNull(),
  sourceRepository: text("source_repository").notNull(),
  sourceRevision: text("source_revision").notNull(),
  sourceDataVersion: text("source_data_version").notNull(),
  cnOnly: boolean("cn_only").notNull().default(false),
  availabilityStatus: text("availability_status").notNull().default("global-snapshot"),
  cnReleaseDate: date("cn_release_date"),
  globalReleaseDate: date("global_release_date"),
  mainPowerNationId: text("main_power_nation_id"),
  mainPowerGroupId: text("main_power_group_id"),
  mainPowerTeamId: text("main_power_team_id"),
  mainFactionId: text("main_faction_id"),
  cnSourceRevision: text("cn_source_revision"),
  regionalMetadataSource: text("regional_metadata_source"),
  importedAt: timestamp("imported_at", { withTimezone: true }).notNull(),
}, (table) => ({
  slugIndex: uniqueIndex("operators_slug_unique").on(table.slug),
}));

export const operatorBiographies = pgTable("operator_biographies", {
  operatorId: text("operator_id").notNull().references(() => operators.id, { onDelete: "restrict" }),
  region: text("region").notNull(),
  sourceRepository: text("source_repository").notNull(),
  sourceRevision: text("source_revision").notNull(),
  sourcePath: text("source_path").notNull(),
  sourceSha256: text("source_sha256").notNull(),
  storyTitle: text("story_title").notNull(),
  originalText: text("original_text").notNull(),
  fields: jsonb("fields").notNull(),
  unrecognizedLines: jsonb("unrecognized_lines").notNull(),
  profileStoryTitle: text("profile_story_title"),
  profileText: text("profile_text"),
  importedAt: timestamp("imported_at", { withTimezone: true }).notNull(),
}, (table) => ({
  primaryKey: primaryKey({ columns: [table.operatorId, table.region, table.sourceRevision] }),
  revisionIndex: index("operator_biographies_region_revision_idx").on(table.region, table.sourceRevision),
  regionCheck: check("operator_biographies_region_check", sql`${table.region} in ('en', 'cn')`),
  sha256Check: check("operator_biographies_sha256_check", sql`${table.sourceSha256} ~ '^[0-9a-fA-F]{64}$'`),
}));
