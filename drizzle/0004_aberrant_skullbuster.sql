ALTER TABLE "chase_states" ADD COLUMN "status" text DEFAULT 'ACTIVE' NOT NULL;--> statement-breakpoint
ALTER TABLE "chase_states" ADD COLUMN "ended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "chase_states" ADD COLUMN "ended_reason" text;--> statement-breakpoint
ALTER TABLE "visits" ADD COLUMN "outcome_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "chase_states_one_active_per_lead" ON "chase_states" USING btree ("lead_id") WHERE status = 'ACTIVE';