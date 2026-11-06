CREATE TABLE "app_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid,
	"token_id" uuid,
	"owner_id" uuid,
	"caller_id" uuid,
	"label" text NOT NULL,
	"status" text DEFAULT 'ringing' NOT NULL,
	"ended_by" text,
	"duration_sec" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answered_at" timestamp with time zone,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "app_calls" ADD CONSTRAINT "app_calls_request_id_decode_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."decode_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_calls" ADD CONSTRAINT "app_calls_token_id_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_calls" ADD CONSTRAINT "app_calls_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_calls" ADD CONSTRAINT "app_calls_caller_id_users_id_fk" FOREIGN KEY ("caller_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_calls_owner_idx" ON "app_calls" USING btree ("owner_id","status");--> statement-breakpoint
CREATE INDEX "app_calls_caller_idx" ON "app_calls" USING btree ("caller_id","status");