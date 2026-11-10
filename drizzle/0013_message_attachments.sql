ALTER TABLE "messages" ADD COLUMN "attachment" text;
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "attachment_kind" text;
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "view_once" boolean DEFAULT false;
