ALTER TABLE "content_items" ADD COLUMN "summary" text;
--> statement-breakpoint
ALTER TABLE "content_items" ADD COLUMN "confidence" real;
--> statement-breakpoint
ALTER TABLE "content_sources" ADD COLUMN "trust" real DEFAULT 0;
