DROP INDEX "container_sync_tombstones_user_depth_updated_idx";--> statement-breakpoint
CREATE INDEX "container_sync_tombstones_user_parent_updated_idx" ON "container_sync_tombstones" USING btree ("user_id","parent_id","updated_at","container_id");--> statement-breakpoint
CREATE INDEX "containers_parent_updated_idx" ON "containers" USING btree ("parent_id","updated_at","id");