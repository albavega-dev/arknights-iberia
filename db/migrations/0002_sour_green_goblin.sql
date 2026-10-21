CREATE TABLE "operators" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"class_name" text NOT NULL,
	"sub_class_id" text,
	"rarity" integer NOT NULL,
	"slug" text NOT NULL,
	"source_locale" text NOT NULL,
	"source_repository" text NOT NULL,
	"source_revision" text NOT NULL,
	"source_data_version" text NOT NULL,
	"imported_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "operators_slug_unique" ON "operators" USING btree ("slug");