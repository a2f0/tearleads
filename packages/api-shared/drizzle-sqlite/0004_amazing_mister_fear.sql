CREATE TABLE `principal_policy_mutation_acknowledgements` (
	`id` text PRIMARY KEY NOT NULL,
	`principal_type` text NOT NULL,
	`principal_id` text NOT NULL,
	`state_hash` text NOT NULL,
	`batch_index` integer NOT NULL,
	`container_id` text NOT NULL,
	`manifest_hash` text NOT NULL,
	`request_json` text NOT NULL,
	`response_json` text NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `principal_policy_mutation_acks_state_idx` ON `principal_policy_mutation_acknowledgements` (`principal_type`,`principal_id`,`state_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `principal_policy_mutation_acks_batch_idx` ON `principal_policy_mutation_acknowledgements` (`principal_type`,`principal_id`,`state_hash`,`batch_index`);--> statement-breakpoint
CREATE UNIQUE INDEX `principal_policy_mutation_acks_container_idx` ON `principal_policy_mutation_acknowledgements` (`principal_type`,`principal_id`,`state_hash`,`container_id`);