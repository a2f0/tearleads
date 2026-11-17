DROP INDEX "containers_parent_depth_idx";--> statement-breakpoint
DROP INDEX "organization_billing_seat_assignments_org_period_idx";--> statement-breakpoint
DROP INDEX "organization_billing_seat_events_org_period_idx";--> statement-breakpoint
DROP INDEX "organization_billing_stripe_seats_due_idx";--> statement-breakpoint
DROP INDEX "principal_policy_mutation_acks_container_idx";--> statement-breakpoint
CREATE INDEX "organization_billing_stripe_seats_due_idx" ON "organization_billing_stripe_seats" USING btree ("next_attempt_at","lease_expires_at","organization_id") WHERE "organization_billing_stripe_seats"."subscription_id" is not null and "organization_billing_stripe_seats"."subscription_item_id" is not null and "organization_billing_stripe_seats"."price_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "principal_policy_mutation_acks_container_idx" ON "principal_policy_mutation_acknowledgements" USING btree ("container_id","principal_type","principal_id","state_hash");