CREATE TABLE "operator_biographies" (
	"operator_id" text NOT NULL,
	"region" text NOT NULL,
	"source_repository" text NOT NULL,
	"source_revision" text NOT NULL,
	"source_path" text NOT NULL,
	"source_sha256" text NOT NULL,
	"story_title" text NOT NULL,
	"original_text" text NOT NULL,
	"fields" jsonb NOT NULL,
	"unrecognized_lines" jsonb NOT NULL,
	"imported_at" timestamp with time zone NOT NULL,
	CONSTRAINT "operator_biographies_operator_id_region_source_revision_pk" PRIMARY KEY("operator_id","region","source_revision"),
	CONSTRAINT "operator_biographies_region_check" CHECK ("operator_biographies"."region" in ('en', 'cn')),
	CONSTRAINT "operator_biographies_sha256_check" CHECK ("operator_biographies"."source_sha256" ~ '^[0-9a-fA-F]{64}$')
);
--> statement-breakpoint
ALTER TABLE "operator_biographies" ADD CONSTRAINT "operator_biographies_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "operator_biographies_region_revision_idx" ON "operator_biographies" USING btree ("region","source_revision");
