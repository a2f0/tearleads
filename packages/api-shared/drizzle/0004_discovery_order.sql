ALTER TABLE "container_document_sync_tombstones" ADD COLUMN "discovery_order" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "container_sync_tombstones" ADD COLUMN "discovery_order" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "containers" ADD COLUMN "discovery_order" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "discovery_order" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "document_tombstones_container_discovery_idx" ON "container_document_sync_tombstones" USING btree ("container_id","discovery_order","document_id");--> statement-breakpoint
CREATE INDEX "container_tombstones_user_parent_discovery_idx" ON "container_sync_tombstones" USING btree ("user_id","parent_id","discovery_order","container_id");--> statement-breakpoint
CREATE INDEX "container_tombstones_user_root_discovery_idx" ON "container_sync_tombstones" USING btree ("user_id","root_discovery_visible","discovery_order","container_id");--> statement-breakpoint
CREATE INDEX "containers_parent_discovery_idx" ON "containers" USING btree ("parent_id","discovery_order","id");--> statement-breakpoint
CREATE INDEX "documents_discovery_idx" ON "documents" USING btree ("discovery_order","id");