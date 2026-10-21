ALTER TABLE "operators" ADD COLUMN "cn_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "operators" ADD COLUMN "availability_status" text DEFAULT 'global-snapshot' NOT NULL;--> statement-breakpoint
ALTER TABLE "operators" ADD COLUMN "cn_release_date" date;--> statement-breakpoint
ALTER TABLE "operators" ADD COLUMN "global_release_date" date;--> statement-breakpoint
ALTER TABLE "operators" ADD COLUMN "cn_source_revision" text;--> statement-breakpoint
ALTER TABLE "operators" ADD COLUMN "regional_metadata_source" text;