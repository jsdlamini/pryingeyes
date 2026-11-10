-- Contact codes go back to being stored only as keyed hashes (link_hash / short_hash).
-- The plaintext link_code / short_code columns added in 0007 defeated that design:
-- a database leak would have exposed every live contact code. They were never needed
-- after minting — the owner sees the full code exactly once, at creation or rotation.
ALTER TABLE "tokens" DROP COLUMN IF EXISTS "link_code";
--> statement-breakpoint
ALTER TABLE "tokens" DROP COLUMN IF EXISTS "short_code";
