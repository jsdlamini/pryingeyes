CREATE TABLE "funnel_daily" (
  "code_id" uuid NOT NULL REFERENCES "tokens"("id") ON DELETE CASCADE,
  "day" date NOT NULL,
  "counter" text NOT NULL,
  "count" integer NOT NULL DEFAULT 1,
  PRIMARY KEY ("code_id", "day", "counter")
);
