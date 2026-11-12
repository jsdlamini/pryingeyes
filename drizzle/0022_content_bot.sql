CREATE TABLE "content_sources" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "url" text NOT NULL,
  "country" text NOT NULL DEFAULT 'SZ',
  "category" text NOT NULL,
  "mode" text NOT NULL DEFAULT 'rules',
  "rules" text,
  "enabled" boolean NOT NULL DEFAULT true,
  "interval_hours" integer NOT NULL DEFAULT 6,
  "last_fetched_at" timestamp with time zone,
  "etag" text,
  "last_modified" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "content_sources_url_uq" UNIQUE ("url")
);
--> statement-breakpoint
CREATE TABLE "content_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "source_id" uuid REFERENCES "content_sources"("id") ON DELETE CASCADE,
  "url" text NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "category" text NOT NULL,
  "country" text NOT NULL,
  "region" text,
  "deadline" timestamp with time zone,
  "status" text NOT NULL DEFAULT 'new',
  "group_id" uuid,
  "post_id" uuid,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "processed_at" timestamp with time zone,
  CONSTRAINT "content_items_url_uq" UNIQUE ("url")
);
--> statement-breakpoint
CREATE TABLE "content_routes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "country" text NOT NULL,
  "category" text NOT NULL,
  "group_id" uuid NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "content_routes_country_category_uq" UNIQUE ("country", "category")
);
--> statement-breakpoint
CREATE TABLE "content_state" (
  "id" integer PRIMARY KEY DEFAULT 1,
  "paused" boolean NOT NULL DEFAULT true,
  "last_run_at" timestamp with time zone,
  "day" text NOT NULL DEFAULT '',
  "daily_count" integer NOT NULL DEFAULT 0,
  CONSTRAINT "content_state_singleton" CHECK ("id" = 1)
);
