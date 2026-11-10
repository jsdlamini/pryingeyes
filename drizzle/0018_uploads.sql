CREATE TABLE "uploads" (
  "id" uuid PRIMARY KEY,
  "owner_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "ext" text NOT NULL,
  "size" integer NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "uploads_owner_idx" ON "uploads" ("owner_id");
