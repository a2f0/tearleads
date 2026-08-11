CREATE TABLE "principal_policy_mutation_acknowledgements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"principal_type" text NOT NULL,
	"principal_id" uuid NOT NULL,
	"state_hash" text NOT NULL,
	"batch_index" integer NOT NULL,
	"container_id" uuid NOT NULL,
	"manifest_hash" text NOT NULL,
	"request_json" text NOT NULL,
	"response_json" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "principal_policy_mutation_acks_state_idx" ON "principal_policy_mutation_acknowledgements" USING btree ("principal_type","principal_id","state_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "principal_policy_mutation_acks_batch_idx" ON "principal_policy_mutation_acknowledgements" USING btree ("principal_type","principal_id","state_hash","batch_index");--> statement-breakpoint
CREATE UNIQUE INDEX "principal_policy_mutation_acks_container_idx" ON "principal_policy_mutation_acknowledgements" USING btree ("principal_type","principal_id","state_hash","container_id");