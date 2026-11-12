ALTER TABLE "groups" ADD COLUMN "country" text;
--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "region" text;
--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "topic" text;
--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "official" boolean DEFAULT false;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "home_country" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "home_region" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "places_source" text DEFAULT 'detected';
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "extra_countries" text[] DEFAULT '{}';
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "seen_country" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "seen_since" timestamp with time zone;
