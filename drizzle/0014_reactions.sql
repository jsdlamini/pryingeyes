CREATE TABLE "reactions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "target_id" uuid NOT NULL,
  "emoji" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "reaction_uq" UNIQUE ("user_id", "kind", "target_id", "emoji")
);
