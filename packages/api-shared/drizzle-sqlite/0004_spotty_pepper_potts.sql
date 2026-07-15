CREATE INDEX `access_manifest_container_grant_subject_manifest_idx` ON `access_manifest_container_grant_projection` (`subject_type`,`subject_id`,`manifest_hash`,`container_id`);--> statement-breakpoint
CREATE INDEX `access_manifest_container_grant_container_manifest_idx` ON `access_manifest_container_grant_projection` (`container_id`,`manifest_hash`);--> statement-breakpoint
CREATE INDEX `access_manifest_document_link_container_manifest_idx` ON `access_manifest_document_link_projection` (`container_id`,`manifest_hash`,`document_id`);--> statement-breakpoint
CREATE INDEX `blob_content_write_headers_organization_blob_idx` ON `blob_content_write_headers` (`organization_id`,`blob_id`);--> statement-breakpoint
CREATE INDEX `blob_stages_expires_at_idx` ON `blob_stages` (`expires_at`,`id`);--> statement-breakpoint
CREATE INDEX `blobs_dereferenced_at_idx` ON `blobs` (`dereferenced_at`) WHERE "blobs"."dereferenced_at" is not null;--> statement-breakpoint
CREATE INDEX `document_content_write_headers_organization_update_idx` ON `document_content_write_headers` (`organization_id`,`update_id`);--> statement-breakpoint
CREATE INDEX `document_updates_document_sequence_idx` ON `document_updates` (`document_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `groups_organization_name_idx` ON `groups` (`organization_id`,`name`,`id`);--> statement-breakpoint
CREATE INDEX `organizations_profile_document_idx` ON `organizations` (`profile_document_id`);--> statement-breakpoint
CREATE INDEX `principal_membership_projection_member_state_idx` ON `principal_membership_projection` (`member_principal_type`,`member_principal_id`,`principal_type`,`principal_id`,`state_hash`);--> statement-breakpoint
CREATE INDEX `users_trial_expiry_idx` ON `users` (`account_status`,`trial_ends_at`,`id`);--> statement-breakpoint
CREATE INDEX `users_purge_candidates_idx` ON `users` (`account_status`,`purge_after`,`purge_started_at`,`id`);