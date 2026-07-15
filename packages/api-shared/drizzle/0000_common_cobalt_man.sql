CREATE TABLE "access_event_dependency_projection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_hash" text NOT NULL,
	"object_kind" text NOT NULL,
	"object_id" uuid NOT NULL,
	"dependency_manifest_hash" text NOT NULL,
	"dependency_index" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "access_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" integer NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"object_kind" text NOT NULL,
	"object_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"previous_manifest_hash" text,
	"dependency_manifest_hashes" jsonb NOT NULL,
	"body_hash" text NOT NULL,
	"body" jsonb NOT NULL,
	"event_hash" text NOT NULL,
	"signer_user_id" uuid NOT NULL,
	"signer_device_id" text NOT NULL,
	"signer_key_fingerprint" text NOT NULL,
	"signature" text NOT NULL,
	"signed_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "access_manifest_container_grant_projection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"manifest_hash" text NOT NULL,
	"container_id" uuid NOT NULL,
	"access_level" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "access_manifest_document_link_projection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"manifest_hash" text NOT NULL,
	"document_id" uuid NOT NULL,
	"container_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "access_manifest_heads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"object_kind" text NOT NULL,
	"object_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"epoch" integer NOT NULL,
	"manifest_hash" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "access_manifest_principal_head_projection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"manifest_hash" text NOT NULL,
	"object_kind" text NOT NULL,
	"object_id" uuid NOT NULL,
	"principal_type" text NOT NULL,
	"principal_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"key_epoch" integer NOT NULL,
	"state_hash" text NOT NULL,
	"key_fingerprint" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "access_manifests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" integer NOT NULL,
	"object_kind" text NOT NULL,
	"object_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"epoch" integer NOT NULL,
	"previous_manifest_hash" text,
	"event_hash" text NOT NULL,
	"structural_hash" text NOT NULL,
	"grant_root" text NOT NULL,
	"referenced_principal_heads" jsonb NOT NULL,
	"key_target_hash" text NOT NULL,
	"manifest_hash" text NOT NULL,
	"state" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attachment_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"slot_id" text NOT NULL,
	"blob_id" uuid NOT NULL,
	"previous_binding_id" uuid,
	"attachment_event_hash" text,
	"document_manifest_hash" text,
	"detached_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blob_audit_objects" (
	"blob_id" uuid PRIMARY KEY NOT NULL,
	"sha256" text NOT NULL,
	"byte_length" integer NOT NULL,
	"live_storage_key" text,
	"retention_mode" text NOT NULL,
	"historical_bytes_retained" boolean NOT NULL,
	"pruned_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blob_content_key_epochs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"blob_id" uuid NOT NULL,
	"content_key_epoch" integer NOT NULL,
	"target_hash" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blob_content_key_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"blob_content_key_epoch_id" uuid NOT NULL,
	"binding_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"container_id" uuid NOT NULL,
	"container_manifest_hash" text NOT NULL,
	"container_key_epoch_id" text NOT NULL,
	"container_key_epoch" integer NOT NULL,
	"wrapped_key" text NOT NULL,
	"wrapping_metadata" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blob_content_write_headers" (
	"record_id" uuid PRIMARY KEY NOT NULL,
	"blob_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"content_key_epoch" integer NOT NULL,
	"access_manifest_hash" text NOT NULL,
	"target_hash" text NOT NULL,
	"encryption_suite" text NOT NULL,
	"content_record_id" text NOT NULL,
	"nonce_domain_hash" text NOT NULL,
	"header_hash" text NOT NULL,
	"header" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blob_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"encrypted_bytes" text NOT NULL,
	"sha256" text NOT NULL,
	"byte_length" integer NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"storage_key" text NOT NULL,
	"encrypted_bytes" text NOT NULL,
	"sha256" text NOT NULL,
	"byte_length" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "container_builtin_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"container_id" uuid NOT NULL,
	"access_level" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "container_document_sync_tombstones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"container_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "container_key_epochs" (
	"id" text PRIMARY KEY NOT NULL,
	"container_id" uuid NOT NULL,
	"key_epoch" integer NOT NULL,
	"access_manifest_hash" text NOT NULL,
	"parent_container_key_epoch_id" text,
	"created_by_event_hash" text NOT NULL,
	"created_by_manifest_hash" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "container_key_wraps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"container_key_epoch_id" text NOT NULL,
	"recipient_kind" text NOT NULL,
	"recipient_id" uuid NOT NULL,
	"recipient_key_epoch_id" text NOT NULL,
	"recipient_key_fingerprint" text NOT NULL,
	"kem_cipher_text" text NOT NULL,
	"wrapped_key" text NOT NULL,
	"wrap_manifest_hash" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "container_metadata_documents" (
	"container_id" uuid PRIMARY KEY NOT NULL,
	"document_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "container_metadata_documents_document_id_unique" UNIQUE("document_id")
);
--> statement-breakpoint
CREATE TABLE "container_sync_tombstones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"container_id" uuid NOT NULL,
	"parent_id" uuid,
	"depth" integer NOT NULL,
	"reason" text NOT NULL,
	"root_discovery_visible" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "containers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"parent_id" uuid,
	"system_slot" text,
	"depth" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_attachment_audit_events" (
	"audit_entry_id" uuid PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"slot_id" text NOT NULL,
	"binding_id" uuid,
	"previous_binding_id" uuid,
	"blob_id" uuid,
	"previous_blob_id" uuid,
	"retention_mode" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_audit_checkpoints" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"sequence" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "document_audit_checkpoints_sequence_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"baseline_update_id" uuid NOT NULL,
	"checkpoint_kind" text NOT NULL,
	"source_version_vector" text NOT NULL,
	"covered_audit_entry_hash" text,
	"previous_checkpoint_hash" text,
	"checkpoint_hash" text NOT NULL,
	"access_epoch" integer NOT NULL,
	"access_manifest_hash" text NOT NULL,
	"access_state_hash" text,
	"actor_user_id" uuid NOT NULL,
	"actor_fingerprint" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "document_audit_checkpoints_id_unique" UNIQUE("id"),
	CONSTRAINT "document_audit_checkpoints_baseline_update_id_unique" UNIQUE("baseline_update_id")
);
--> statement-breakpoint
CREATE TABLE "document_audit_entries" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"sequence" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "document_audit_entries_sequence_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"event_type" text NOT NULL,
	"access_epoch" integer NOT NULL,
	"access_manifest_hash" text NOT NULL,
	"access_state_hash" text,
	"actor_user_id" uuid NOT NULL,
	"actor_fingerprint" text NOT NULL,
	"prev_entry_hash" text,
	"entry_hash" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "document_audit_entries_id_unique" UNIQUE("id")
);
--> statement-breakpoint
CREATE TABLE "document_container_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"container_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_content_key_epochs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"content_key_epoch" integer NOT NULL,
	"link_set_manifest_hash" text NOT NULL,
	"target_hash" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_content_key_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_content_key_epoch_id" uuid NOT NULL,
	"container_id" uuid NOT NULL,
	"container_manifest_hash" text NOT NULL,
	"container_key_epoch_id" text NOT NULL,
	"container_key_epoch" integer NOT NULL,
	"wrapped_key" text NOT NULL,
	"wrapping_metadata" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_content_write_headers" (
	"update_id" uuid PRIMARY KEY NOT NULL,
	"document_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"content_key_epoch" integer NOT NULL,
	"access_manifest_hash" text NOT NULL,
	"target_hash" text NOT NULL,
	"encryption_suite" text NOT NULL,
	"content_record_id" text NOT NULL,
	"nonce_domain_hash" text NOT NULL,
	"header_hash" text NOT NULL,
	"header" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_update_audit_events" (
	"audit_entry_id" uuid PRIMARY KEY NOT NULL,
	"live_update_id" uuid NOT NULL,
	"partial_start_version_vector" text NOT NULL,
	"partial_end_version_vector" text NOT NULL,
	"source_version_vector" text,
	"encrypted_update_sha256" text NOT NULL,
	"encrypted_update_byte_length" integer NOT NULL,
	CONSTRAINT "document_update_audit_events_live_update_id_unique" UNIQUE("live_update_id")
);
--> statement-breakpoint
CREATE TABLE "document_update_spans" (
	"document_id" uuid NOT NULL,
	"update_id" uuid NOT NULL,
	"peer_id" text NOT NULL,
	"start_counter" integer NOT NULL,
	"end_counter" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_updates" (
	"sequence" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "document_updates_sequence_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"access_epoch" integer NOT NULL,
	"author_fingerprint" text NOT NULL,
	"encrypted_data" text NOT NULL,
	"byte_length" integer NOT NULL,
	"partial_start_version_vector" text NOT NULL,
	"partial_end_version_vector" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "document_updates_id_unique" UNIQUE("id")
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_by_fingerprint" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_roster_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"profile_document_id" uuid,
	"joined_at" timestamp DEFAULT now() NOT NULL,
	"disabled_at" timestamp,
	"disabled_by_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_group_id" uuid NOT NULL,
	"member_group_id" uuid NOT NULL,
	"name" text NOT NULL,
	"profile_document_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "principal_epoch_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"principal_type" text NOT NULL,
	"principal_id" uuid NOT NULL,
	"epoch" integer NOT NULL,
	"introduced_by_state_hash" text NOT NULL,
	"encapsulation_public_key" text NOT NULL,
	"key_fingerprint" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "principal_member_envelopes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"principal_type" text NOT NULL,
	"principal_id" uuid NOT NULL,
	"state_hash" text NOT NULL,
	"epoch" integer NOT NULL,
	"member_principal_type" text NOT NULL,
	"member_principal_id" uuid NOT NULL,
	"member_key_fingerprint" text NOT NULL,
	"kem_cipher_text" text NOT NULL,
	"wrapped_key" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "principal_membership_projection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"principal_type" text NOT NULL,
	"principal_id" uuid NOT NULL,
	"state_hash" text NOT NULL,
	"member_principal_type" text NOT NULL,
	"member_principal_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "principal_state_payloads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"principal_type" text NOT NULL,
	"principal_id" uuid NOT NULL,
	"state_hash" text NOT NULL,
	"cipher_suite" text NOT NULL,
	"ciphertext" text NOT NULL,
	"ciphertext_hash" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "principal_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"principal_type" text NOT NULL,
	"principal_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"prev_state_hash" text,
	"key_epoch" integer NOT NULL,
	"encapsulation_public_key" text NOT NULL,
	"key_fingerprint" text NOT NULL,
	"membership_mode" text NOT NULL,
	"membership_root" text NOT NULL,
	"projection_root" text NOT NULL,
	"payload_ciphertext_hash" text NOT NULL,
	"member_count" integer NOT NULL,
	"state_hash" text NOT NULL,
	"signed_at" timestamp NOT NULL,
	"signer_user_id" uuid NOT NULL,
	"signer_user_key_fingerprint" text NOT NULL,
	"signature" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fingerprint" text NOT NULL,
	"signing_public_key" text NOT NULL,
	"encapsulation_public_key" text NOT NULL,
	"encapsulation_key_fingerprint" text NOT NULL,
	"default_organization_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_fingerprint_unique" UNIQUE("fingerprint")
);
--> statement-breakpoint
ALTER TABLE "blob_content_key_targets" ADD CONSTRAINT "blob_content_key_targets_blob_content_key_epoch_id_blob_content_key_epochs_id_fk" FOREIGN KEY ("blob_content_key_epoch_id") REFERENCES "public"."blob_content_key_epochs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_attachment_audit_events" ADD CONSTRAINT "document_attachment_audit_events_audit_entry_id_document_audit_entries_id_fk" FOREIGN KEY ("audit_entry_id") REFERENCES "public"."document_audit_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_content_key_targets" ADD CONSTRAINT "document_content_key_targets_document_content_key_epoch_id_document_content_key_epochs_id_fk" FOREIGN KEY ("document_content_key_epoch_id") REFERENCES "public"."document_content_key_epochs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_update_audit_events" ADD CONSTRAINT "document_update_audit_events_audit_entry_id_document_audit_entries_id_fk" FOREIGN KEY ("audit_entry_id") REFERENCES "public"."document_audit_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_event_dependency_projection_event_idx" ON "access_event_dependency_projection" USING btree ("event_hash");--> statement-breakpoint
CREATE INDEX "access_event_dependency_projection_dependency_idx" ON "access_event_dependency_projection" USING btree ("dependency_manifest_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "access_event_dependency_projection_unique_idx" ON "access_event_dependency_projection" USING btree ("event_hash","dependency_manifest_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "access_events_event_id_idx" ON "access_events" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "access_events_event_hash_idx" ON "access_events" USING btree ("event_hash");--> statement-breakpoint
CREATE INDEX "access_events_object_idx" ON "access_events" USING btree ("object_kind","object_id");--> statement-breakpoint
CREATE INDEX "access_events_signer_idx" ON "access_events" USING btree ("signer_user_id","signer_key_fingerprint");--> statement-breakpoint
CREATE INDEX "access_manifest_container_grant_manifest_idx" ON "access_manifest_container_grant_projection" USING btree ("manifest_hash");--> statement-breakpoint
CREATE INDEX "access_manifest_container_grant_subject_idx" ON "access_manifest_container_grant_projection" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "access_manifest_container_grant_container_idx" ON "access_manifest_container_grant_projection" USING btree ("container_id");--> statement-breakpoint
CREATE UNIQUE INDEX "access_manifest_container_grant_unique_idx" ON "access_manifest_container_grant_projection" USING btree ("manifest_hash","subject_type","subject_id","access_level");--> statement-breakpoint
CREATE INDEX "access_manifest_document_link_manifest_idx" ON "access_manifest_document_link_projection" USING btree ("manifest_hash");--> statement-breakpoint
CREATE INDEX "access_manifest_document_link_document_idx" ON "access_manifest_document_link_projection" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "access_manifest_document_link_container_idx" ON "access_manifest_document_link_projection" USING btree ("container_id");--> statement-breakpoint
CREATE UNIQUE INDEX "access_manifest_document_link_unique_idx" ON "access_manifest_document_link_projection" USING btree ("manifest_hash","container_id");--> statement-breakpoint
CREATE UNIQUE INDEX "access_manifest_heads_object_idx" ON "access_manifest_heads" USING btree ("object_kind","object_id");--> statement-breakpoint
CREATE INDEX "access_manifest_heads_manifest_hash_idx" ON "access_manifest_heads" USING btree ("manifest_hash");--> statement-breakpoint
CREATE INDEX "access_manifest_principal_projection_manifest_idx" ON "access_manifest_principal_head_projection" USING btree ("manifest_hash");--> statement-breakpoint
CREATE INDEX "access_manifest_principal_projection_principal_idx" ON "access_manifest_principal_head_projection" USING btree ("principal_type","principal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "access_manifest_principal_projection_unique_idx" ON "access_manifest_principal_head_projection" USING btree ("manifest_hash","principal_type","principal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "access_manifests_manifest_hash_idx" ON "access_manifests" USING btree ("manifest_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "access_manifests_event_hash_idx" ON "access_manifests" USING btree ("event_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "access_manifests_object_epoch_idx" ON "access_manifests" USING btree ("object_kind","object_id","epoch");--> statement-breakpoint
CREATE INDEX "access_manifests_object_idx" ON "access_manifests" USING btree ("object_kind","object_id");--> statement-breakpoint
CREATE INDEX "attachment_bindings_document_idx" ON "attachment_bindings" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "attachment_bindings_blob_idx" ON "attachment_bindings" USING btree ("blob_id");--> statement-breakpoint
CREATE INDEX "attachment_bindings_previous_binding_id_idx" ON "attachment_bindings" USING btree ("previous_binding_id");--> statement-breakpoint
CREATE INDEX "attachment_bindings_attachment_event_hash_idx" ON "attachment_bindings" USING btree ("attachment_event_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "attachment_bindings_document_slot_active_idx" ON "attachment_bindings" USING btree ("document_id","slot_id") WHERE "attachment_bindings"."detached_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "blob_content_key_epochs_blob_epoch_idx" ON "blob_content_key_epochs" USING btree ("blob_id","content_key_epoch");--> statement-breakpoint
CREATE INDEX "blob_content_key_epochs_blob_idx" ON "blob_content_key_epochs" USING btree ("blob_id");--> statement-breakpoint
CREATE INDEX "blob_content_key_epochs_target_idx" ON "blob_content_key_epochs" USING btree ("target_hash");--> statement-breakpoint
CREATE INDEX "blob_content_key_targets_epoch_idx" ON "blob_content_key_targets" USING btree ("blob_content_key_epoch_id");--> statement-breakpoint
CREATE INDEX "blob_content_key_targets_binding_idx" ON "blob_content_key_targets" USING btree ("binding_id");--> statement-breakpoint
CREATE INDEX "blob_content_key_targets_container_epoch_idx" ON "blob_content_key_targets" USING btree ("container_key_epoch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "blob_content_key_targets_epoch_binding_container_idx" ON "blob_content_key_targets" USING btree ("blob_content_key_epoch_id","binding_id","document_id","container_id");--> statement-breakpoint
CREATE INDEX "blob_content_write_headers_blob_epoch_idx" ON "blob_content_write_headers" USING btree ("blob_id","content_key_epoch");--> statement-breakpoint
CREATE UNIQUE INDEX "blob_content_write_headers_header_hash_idx" ON "blob_content_write_headers" USING btree ("header_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "blob_content_write_headers_content_record_idx" ON "blob_content_write_headers" USING btree ("blob_id","content_key_epoch","content_record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "blob_content_write_headers_nonce_domain_idx" ON "blob_content_write_headers" USING btree ("blob_id","content_key_epoch","nonce_domain_hash");--> statement-breakpoint
CREATE INDEX "container_builtin_grants_org_idx" ON "container_builtin_grants" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "container_builtin_grants_identity_idx" ON "container_builtin_grants" USING btree ("container_id","subject_type","subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "container_document_sync_tombstones_unique_idx" ON "container_document_sync_tombstones" USING btree ("container_id","document_id");--> statement-breakpoint
CREATE INDEX "container_document_sync_tombstones_container_updated_idx" ON "container_document_sync_tombstones" USING btree ("container_id","updated_at","document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "container_key_epochs_container_epoch_idx" ON "container_key_epochs" USING btree ("container_id","key_epoch");--> statement-breakpoint
CREATE INDEX "container_key_epochs_container_idx" ON "container_key_epochs" USING btree ("container_id");--> statement-breakpoint
CREATE INDEX "container_key_epochs_access_manifest_idx" ON "container_key_epochs" USING btree ("access_manifest_hash");--> statement-breakpoint
CREATE INDEX "container_key_epochs_parent_idx" ON "container_key_epochs" USING btree ("parent_container_key_epoch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "container_key_wraps_epoch_recipient_idx" ON "container_key_wraps" USING btree ("container_key_epoch_id","recipient_kind","recipient_id","recipient_key_epoch_id");--> statement-breakpoint
CREATE INDEX "container_key_wraps_epoch_idx" ON "container_key_wraps" USING btree ("container_key_epoch_id");--> statement-breakpoint
CREATE INDEX "container_key_wraps_recipient_idx" ON "container_key_wraps" USING btree ("recipient_kind","recipient_id");--> statement-breakpoint
CREATE INDEX "container_key_wraps_manifest_idx" ON "container_key_wraps" USING btree ("wrap_manifest_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "container_sync_tombstones_user_container_idx" ON "container_sync_tombstones" USING btree ("user_id","container_id");--> statement-breakpoint
CREATE INDEX "container_sync_tombstones_user_parent_updated_idx" ON "container_sync_tombstones" USING btree ("user_id","parent_id","updated_at","container_id");--> statement-breakpoint
CREATE INDEX "container_sync_tombstones_user_root_updated_idx" ON "container_sync_tombstones" USING btree ("user_id","root_discovery_visible","updated_at","container_id");--> statement-breakpoint
CREATE UNIQUE INDEX "containers_org_root_idx" ON "containers" USING btree ("organization_id") WHERE "containers"."parent_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "containers_org_system_slot_idx" ON "containers" USING btree ("organization_id","system_slot") WHERE "containers"."system_slot" is not null;--> statement-breakpoint
CREATE INDEX "containers_parent_id_idx" ON "containers" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "containers_parent_updated_idx" ON "containers" USING btree ("parent_id","updated_at","id");--> statement-breakpoint
CREATE INDEX "containers_org_depth_updated_idx" ON "containers" USING btree ("organization_id","depth","updated_at","id");--> statement-breakpoint
CREATE INDEX "containers_parent_depth_idx" ON "containers" USING btree ("parent_id","depth");--> statement-breakpoint
CREATE INDEX "document_audit_checkpoints_document_sequence_idx" ON "document_audit_checkpoints" USING btree ("document_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "document_audit_checkpoints_document_hash_idx" ON "document_audit_checkpoints" USING btree ("document_id","checkpoint_hash");--> statement-breakpoint
CREATE INDEX "document_audit_checkpoints_document_created_idx" ON "document_audit_checkpoints" USING btree ("document_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "document_audit_entries_document_sequence_idx" ON "document_audit_entries" USING btree ("document_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "document_audit_entries_document_hash_idx" ON "document_audit_entries" USING btree ("document_id","entry_hash");--> statement-breakpoint
CREATE INDEX "document_audit_entries_document_created_idx" ON "document_audit_entries" USING btree ("document_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "document_container_links_document_container_idx" ON "document_container_links" USING btree ("document_id","container_id");--> statement-breakpoint
CREATE INDEX "document_container_links_container_idx" ON "document_container_links" USING btree ("container_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_content_key_epochs_document_epoch_idx" ON "document_content_key_epochs" USING btree ("document_id","content_key_epoch");--> statement-breakpoint
CREATE INDEX "document_content_key_epochs_document_idx" ON "document_content_key_epochs" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "document_content_key_epochs_target_idx" ON "document_content_key_epochs" USING btree ("target_hash");--> statement-breakpoint
CREATE INDEX "document_content_key_targets_epoch_idx" ON "document_content_key_targets" USING btree ("document_content_key_epoch_id");--> statement-breakpoint
CREATE INDEX "document_content_key_targets_container_epoch_idx" ON "document_content_key_targets" USING btree ("container_key_epoch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_content_key_targets_epoch_container_idx" ON "document_content_key_targets" USING btree ("document_content_key_epoch_id","container_id");--> statement-breakpoint
CREATE INDEX "document_content_write_headers_document_epoch_idx" ON "document_content_write_headers" USING btree ("document_id","content_key_epoch");--> statement-breakpoint
CREATE UNIQUE INDEX "document_content_write_headers_header_hash_idx" ON "document_content_write_headers" USING btree ("header_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "document_content_write_headers_content_record_idx" ON "document_content_write_headers" USING btree ("document_id","content_key_epoch","content_record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_content_write_headers_nonce_domain_idx" ON "document_content_write_headers" USING btree ("document_id","content_key_epoch","nonce_domain_hash");--> statement-breakpoint
CREATE INDEX "document_update_spans_peer_counter_idx" ON "document_update_spans" USING btree ("document_id","peer_id","end_counter");--> statement-breakpoint
CREATE UNIQUE INDEX "document_update_spans_update_peer_idx" ON "document_update_spans" USING btree ("update_id","peer_id");--> statement-breakpoint
CREATE INDEX "documents_updated_at_id_idx" ON "documents" USING btree ("updated_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_roster_entries_org_user_idx" ON "organization_roster_entries" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "organization_roster_entries_org_status_idx" ON "organization_roster_entries" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "organization_roster_entries_profile_document_idx" ON "organization_roster_entries" USING btree ("profile_document_id");--> statement-breakpoint
CREATE INDEX "principal_epoch_keys_principal_idx" ON "principal_epoch_keys" USING btree ("principal_type","principal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "principal_epoch_keys_principal_epoch_idx" ON "principal_epoch_keys" USING btree ("principal_type","principal_id","epoch");--> statement-breakpoint
CREATE INDEX "principal_member_envelopes_principal_idx" ON "principal_member_envelopes" USING btree ("principal_type","principal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "principal_member_envelopes_state_member_idx" ON "principal_member_envelopes" USING btree ("principal_type","principal_id","state_hash","member_principal_type","member_principal_id");--> statement-breakpoint
CREATE INDEX "principal_membership_projection_principal_idx" ON "principal_membership_projection" USING btree ("principal_type","principal_id");--> statement-breakpoint
CREATE INDEX "principal_membership_projection_member_idx" ON "principal_membership_projection" USING btree ("member_principal_type","member_principal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "principal_membership_projection_state_member_idx" ON "principal_membership_projection" USING btree ("principal_type","principal_id","state_hash","member_principal_type","member_principal_id");--> statement-breakpoint
CREATE INDEX "principal_state_payloads_principal_idx" ON "principal_state_payloads" USING btree ("principal_type","principal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "principal_state_payloads_principal_state_idx" ON "principal_state_payloads" USING btree ("principal_type","principal_id","state_hash");--> statement-breakpoint
CREATE INDEX "principal_states_principal_idx" ON "principal_states" USING btree ("principal_type","principal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "principal_states_principal_version_idx" ON "principal_states" USING btree ("principal_type","principal_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "principal_states_principal_state_hash_idx" ON "principal_states" USING btree ("principal_type","principal_id","state_hash");