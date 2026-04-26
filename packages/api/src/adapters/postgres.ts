import { PGlite } from "@electric-sql/pglite";
import { loroSql } from "@tearleads/loro/server";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../schema";

const client = new PGlite({ debug: 0 });
export const db = drizzle({ client, schema });
type TransactionCallback = Parameters<(typeof db)["transaction"]>[0];
export type DatabaseTransaction = Parameters<TransactionCallback>[0];
export type DatabaseExecutor = typeof db | DatabaseTransaction;

await client.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fingerprint TEXT NOT NULL UNIQUE,
    signing_public_key TEXT NOT NULL,
    encapsulation_public_key TEXT NOT NULL,
    encapsulation_key_fingerprint TEXT NOT NULL,
    default_organization_id UUID NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS containers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,
    parent_id UUID,
    created_at TIMESTAMP NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS containers_org_root_idx
    ON containers (organization_id) WHERE parent_id IS NULL;
  CREATE INDEX IF NOT EXISTS containers_parent_id_idx
    ON containers (parent_id);
  CREATE TABLE IF NOT EXISTS groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID,
    name TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS principal_states (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    principal_type TEXT NOT NULL,
    principal_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    prev_state_hash TEXT,
    key_epoch INTEGER NOT NULL,
    encapsulation_public_key TEXT NOT NULL,
    key_fingerprint TEXT NOT NULL,
    membership_mode TEXT NOT NULL,
    membership_root TEXT NOT NULL,
    projection_root TEXT NOT NULL,
    payload_ciphertext_hash TEXT NOT NULL,
    member_count INTEGER NOT NULL,
    state_hash TEXT NOT NULL,
    signed_at TIMESTAMP NOT NULL,
    signer_user_id UUID NOT NULL,
    signer_user_key_fingerprint TEXT NOT NULL,
    signature TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS principal_state_payloads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    principal_type TEXT NOT NULL,
    principal_id TEXT NOT NULL,
    state_hash TEXT NOT NULL,
    cipher_suite TEXT NOT NULL,
    ciphertext TEXT NOT NULL,
    ciphertext_hash TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS principal_membership_projection (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    principal_type TEXT NOT NULL,
    principal_id TEXT NOT NULL,
    state_hash TEXT NOT NULL,
    member_principal_type TEXT NOT NULL,
    member_principal_id TEXT NOT NULL,
    role TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS principal_epoch_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    principal_type TEXT NOT NULL,
    principal_id TEXT NOT NULL,
    epoch INTEGER NOT NULL,
    introduced_by_state_hash TEXT NOT NULL,
    encapsulation_public_key TEXT NOT NULL,
    key_fingerprint TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS principal_member_envelopes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    principal_type TEXT NOT NULL,
    principal_id TEXT NOT NULL,
    state_hash TEXT NOT NULL,
    epoch INTEGER NOT NULL,
    member_principal_type TEXT NOT NULL,
    member_principal_id TEXT NOT NULL,
    member_key_fingerprint TEXT NOT NULL,
    kem_cipher_text TEXT NOT NULL,
    wrapped_key TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS object_access_grants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    object_type TEXT NOT NULL,
    object_id TEXT NOT NULL,
    subject_type TEXT NOT NULL,
    subject_id TEXT NOT NULL,
    access_level TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS object_access_epochs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    object_type TEXT NOT NULL,
    object_id TEXT NOT NULL,
    epoch INTEGER NOT NULL,
    access_fingerprint TEXT NOT NULL,
    access_state_hash TEXT,
    updated_at TIMESTAMP NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS object_recipient_envelopes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    object_type TEXT NOT NULL,
    object_id TEXT NOT NULL,
    epoch INTEGER NOT NULL,
    recipient_principal_type TEXT NOT NULL,
    recipient_principal_id TEXT NOT NULL,
    recipient_key_fingerprint TEXT NOT NULL,
    kem_cipher_text TEXT NOT NULL,
    wrapped_key TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS access_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    version INTEGER NOT NULL,
    event_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    object_kind TEXT NOT NULL,
    object_id TEXT NOT NULL,
    organization_id TEXT NOT NULL,
    previous_manifest_hash TEXT,
    dependency_manifest_hashes JSONB NOT NULL,
    body_hash TEXT NOT NULL,
    body JSONB NOT NULL,
    event_hash TEXT NOT NULL,
    signer_user_id TEXT NOT NULL,
    signer_device_id TEXT NOT NULL,
    signer_key_fingerprint TEXT NOT NULL,
    signature TEXT NOT NULL,
    signed_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS access_manifests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    version INTEGER NOT NULL,
    object_kind TEXT NOT NULL,
    object_id TEXT NOT NULL,
    organization_id TEXT NOT NULL,
    epoch INTEGER NOT NULL,
    previous_manifest_hash TEXT,
    event_hash TEXT NOT NULL,
    structural_hash TEXT NOT NULL,
    grant_root TEXT NOT NULL,
    referenced_principal_heads JSONB NOT NULL,
    key_target_hash TEXT NOT NULL,
    manifest_hash TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS access_manifest_heads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    object_kind TEXT NOT NULL,
    object_id TEXT NOT NULL,
    organization_id TEXT NOT NULL,
    epoch INTEGER NOT NULL,
    manifest_hash TEXT NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS container_key_epochs (
    id TEXT PRIMARY KEY,
    container_id TEXT NOT NULL,
    key_epoch INTEGER NOT NULL,
    access_manifest_hash TEXT NOT NULL,
    parent_container_key_epoch_id TEXT,
    created_by_event_hash TEXT NOT NULL,
    created_by_manifest_hash TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS container_key_wraps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    container_key_epoch_id TEXT NOT NULL,
    recipient_kind TEXT NOT NULL,
    recipient_id TEXT NOT NULL,
    recipient_key_epoch_id TEXT NOT NULL,
    recipient_key_fingerprint TEXT NOT NULL,
    kem_cipher_text TEXT NOT NULL,
    wrapped_key TEXT NOT NULL,
    wrap_manifest_hash TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS access_event_dependency_projection (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_hash TEXT NOT NULL,
    object_kind TEXT NOT NULL,
    object_id TEXT NOT NULL,
    dependency_manifest_hash TEXT NOT NULL,
    dependency_index INTEGER NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS access_manifest_principal_head_projection (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    manifest_hash TEXT NOT NULL,
    object_kind TEXT NOT NULL,
    object_id TEXT NOT NULL,
    principal_type TEXT NOT NULL,
    principal_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    key_epoch INTEGER NOT NULL,
    state_hash TEXT NOT NULL,
    key_fingerprint TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS access_manifest_document_link_projection (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    manifest_hash TEXT NOT NULL,
    document_id TEXT NOT NULL,
    container_id TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS document_container_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id TEXT NOT NULL,
    container_id UUID NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS container_metadata_documents (
    container_id UUID PRIMARY KEY,
    document_id UUID NOT NULL UNIQUE,
    created_at TIMESTAMP NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS document_audit_checkpoints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL,
    sequence BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    baseline_update_id UUID NOT NULL UNIQUE,
    checkpoint_kind TEXT NOT NULL,
    source_version_vector TEXT NOT NULL,
    covered_audit_entry_hash TEXT,
    previous_checkpoint_hash TEXT,
    checkpoint_hash TEXT NOT NULL,
    access_epoch INTEGER NOT NULL,
    access_fingerprint TEXT NOT NULL,
    access_state_hash TEXT,
    actor_user_id UUID NOT NULL,
    actor_fingerprint TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS document_audit_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL,
    sequence BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    event_type TEXT NOT NULL,
    access_epoch INTEGER NOT NULL,
    access_fingerprint TEXT NOT NULL,
    access_state_hash TEXT,
    actor_user_id UUID NOT NULL,
    actor_fingerprint TEXT NOT NULL,
    prev_entry_hash TEXT,
    entry_hash TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now()
  );
  ALTER TABLE document_audit_checkpoints
    ADD COLUMN IF NOT EXISTS access_state_hash TEXT;
  ALTER TABLE document_audit_entries
    ADD COLUMN IF NOT EXISTS access_state_hash TEXT;
  CREATE TABLE IF NOT EXISTS document_update_audit_events (
    audit_entry_id UUID PRIMARY KEY REFERENCES document_audit_entries(id),
    live_update_id UUID NOT NULL UNIQUE,
    partial_start_version_vector TEXT NOT NULL,
    partial_end_version_vector TEXT NOT NULL,
    source_version_vector TEXT,
    encrypted_update_sha256 TEXT NOT NULL,
    encrypted_update_byte_length INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS blob_audit_objects (
    blob_id UUID PRIMARY KEY,
    sha256 TEXT NOT NULL,
    byte_length INTEGER NOT NULL,
    live_storage_key TEXT,
    retention_mode TEXT NOT NULL,
    historical_bytes_retained BOOLEAN NOT NULL,
    pruned_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS document_attachment_audit_events (
    audit_entry_id UUID PRIMARY KEY REFERENCES document_audit_entries(id),
    action TEXT NOT NULL,
    slot_id TEXT NOT NULL,
    binding_id UUID,
    previous_binding_id UUID,
    blob_id UUID,
    previous_blob_id UUID,
    retention_mode TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS blobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    storage_key TEXT NOT NULL,
    encrypted_bytes TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    byte_length INTEGER NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS blob_stages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id UUID NOT NULL,
    encrypted_bytes TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    byte_length INTEGER NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS attachment_bindings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id TEXT NOT NULL,
    slot_id TEXT NOT NULL,
    blob_id UUID NOT NULL,
    previous_binding_id UUID,
    detached_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS principal_states_principal_idx
    ON principal_states (principal_type, principal_id);
  CREATE UNIQUE INDEX IF NOT EXISTS principal_states_principal_version_idx
    ON principal_states (principal_type, principal_id, version);
  CREATE UNIQUE INDEX IF NOT EXISTS principal_states_principal_state_hash_idx
    ON principal_states (principal_type, principal_id, state_hash);
  CREATE INDEX IF NOT EXISTS principal_state_payloads_principal_idx
    ON principal_state_payloads (principal_type, principal_id);
  CREATE UNIQUE INDEX IF NOT EXISTS principal_state_payloads_principal_state_idx
    ON principal_state_payloads (principal_type, principal_id, state_hash);
  CREATE INDEX IF NOT EXISTS principal_membership_projection_principal_idx
    ON principal_membership_projection (principal_type, principal_id);
  CREATE UNIQUE INDEX IF NOT EXISTS principal_membership_projection_state_member_idx
    ON principal_membership_projection (
      principal_type,
      principal_id,
      state_hash,
      member_principal_type,
      member_principal_id
    );
  CREATE INDEX IF NOT EXISTS principal_epoch_keys_principal_idx
    ON principal_epoch_keys (principal_type, principal_id);
  CREATE UNIQUE INDEX IF NOT EXISTS principal_epoch_keys_principal_epoch_idx
    ON principal_epoch_keys (principal_type, principal_id, epoch);
  CREATE INDEX IF NOT EXISTS principal_member_envelopes_principal_idx
    ON principal_member_envelopes (principal_type, principal_id);
  CREATE UNIQUE INDEX IF NOT EXISTS principal_member_envelopes_state_member_idx
    ON principal_member_envelopes (
      principal_type,
      principal_id,
      state_hash,
      member_principal_type,
      member_principal_id
    );
  CREATE INDEX IF NOT EXISTS object_access_grants_object_idx
    ON object_access_grants (object_type, object_id);
  CREATE INDEX IF NOT EXISTS object_access_epochs_object_idx
    ON object_access_epochs (object_type, object_id);
  CREATE UNIQUE INDEX IF NOT EXISTS object_access_epochs_object_epoch_idx
    ON object_access_epochs (object_type, object_id, epoch);
  CREATE INDEX IF NOT EXISTS object_recipient_envelopes_object_epoch_idx
    ON object_recipient_envelopes (object_type, object_id, epoch);
  CREATE UNIQUE INDEX IF NOT EXISTS object_recipient_envelopes_object_epoch_recipient_idx
    ON object_recipient_envelopes (
      object_type,
      object_id,
      epoch,
      recipient_key_fingerprint
    );
  CREATE UNIQUE INDEX IF NOT EXISTS access_events_event_id_idx
    ON access_events (event_id);
  CREATE UNIQUE INDEX IF NOT EXISTS access_events_event_hash_idx
    ON access_events (event_hash);
  CREATE INDEX IF NOT EXISTS access_events_object_idx
    ON access_events (object_kind, object_id);
  CREATE INDEX IF NOT EXISTS access_events_signer_idx
    ON access_events (signer_user_id, signer_key_fingerprint);
  CREATE UNIQUE INDEX IF NOT EXISTS access_manifests_manifest_hash_idx
    ON access_manifests (manifest_hash);
  CREATE UNIQUE INDEX IF NOT EXISTS access_manifests_event_hash_idx
    ON access_manifests (event_hash);
  CREATE UNIQUE INDEX IF NOT EXISTS access_manifests_object_epoch_idx
    ON access_manifests (object_kind, object_id, epoch);
  CREATE INDEX IF NOT EXISTS access_manifests_object_idx
    ON access_manifests (object_kind, object_id);
  CREATE UNIQUE INDEX IF NOT EXISTS access_manifest_heads_object_idx
    ON access_manifest_heads (object_kind, object_id);
  CREATE INDEX IF NOT EXISTS access_manifest_heads_manifest_hash_idx
    ON access_manifest_heads (manifest_hash);
  CREATE UNIQUE INDEX IF NOT EXISTS container_key_epochs_container_epoch_idx
    ON container_key_epochs (container_id, key_epoch);
  CREATE INDEX IF NOT EXISTS container_key_epochs_container_idx
    ON container_key_epochs (container_id);
  CREATE INDEX IF NOT EXISTS container_key_epochs_access_manifest_idx
    ON container_key_epochs (access_manifest_hash);
  CREATE INDEX IF NOT EXISTS container_key_epochs_parent_idx
    ON container_key_epochs (parent_container_key_epoch_id);
  CREATE UNIQUE INDEX IF NOT EXISTS container_key_wraps_epoch_recipient_idx
    ON container_key_wraps (
      container_key_epoch_id,
      recipient_kind,
      recipient_id,
      recipient_key_epoch_id
    );
  CREATE INDEX IF NOT EXISTS container_key_wraps_epoch_idx
    ON container_key_wraps (container_key_epoch_id);
  CREATE INDEX IF NOT EXISTS container_key_wraps_recipient_idx
    ON container_key_wraps (recipient_kind, recipient_id);
  CREATE INDEX IF NOT EXISTS container_key_wraps_manifest_idx
    ON container_key_wraps (wrap_manifest_hash);
  CREATE INDEX IF NOT EXISTS access_event_dependency_projection_event_idx
    ON access_event_dependency_projection (event_hash);
  CREATE INDEX IF NOT EXISTS access_event_dependency_projection_dependency_idx
    ON access_event_dependency_projection (dependency_manifest_hash);
  CREATE UNIQUE INDEX IF NOT EXISTS access_event_dependency_projection_unique_idx
    ON access_event_dependency_projection (
      event_hash,
      dependency_manifest_hash
    );
  CREATE INDEX IF NOT EXISTS access_manifest_principal_projection_manifest_idx
    ON access_manifest_principal_head_projection (manifest_hash);
  CREATE INDEX IF NOT EXISTS access_manifest_principal_projection_principal_idx
    ON access_manifest_principal_head_projection (principal_type, principal_id);
  CREATE UNIQUE INDEX IF NOT EXISTS access_manifest_principal_projection_unique_idx
    ON access_manifest_principal_head_projection (
      manifest_hash,
      principal_type,
      principal_id
    );
  CREATE INDEX IF NOT EXISTS access_manifest_document_link_manifest_idx
    ON access_manifest_document_link_projection (manifest_hash);
  CREATE INDEX IF NOT EXISTS access_manifest_document_link_document_idx
    ON access_manifest_document_link_projection (document_id);
  CREATE INDEX IF NOT EXISTS access_manifest_document_link_container_idx
    ON access_manifest_document_link_projection (container_id);
  CREATE UNIQUE INDEX IF NOT EXISTS access_manifest_document_link_unique_idx
    ON access_manifest_document_link_projection (
      manifest_hash,
      container_id
    );
  CREATE UNIQUE INDEX IF NOT EXISTS document_container_links_document_container_idx
    ON document_container_links (document_id, container_id);
  CREATE INDEX IF NOT EXISTS document_container_links_container_idx
    ON document_container_links (container_id);
  CREATE INDEX IF NOT EXISTS document_audit_checkpoints_document_sequence_idx
    ON document_audit_checkpoints (document_id, sequence);
  CREATE UNIQUE INDEX IF NOT EXISTS document_audit_checkpoints_document_hash_idx
    ON document_audit_checkpoints (document_id, checkpoint_hash);
  CREATE INDEX IF NOT EXISTS document_audit_checkpoints_document_created_idx
    ON document_audit_checkpoints (document_id, created_at);
  CREATE UNIQUE INDEX IF NOT EXISTS document_audit_entries_document_sequence_idx
    ON document_audit_entries (document_id, sequence);
  CREATE UNIQUE INDEX IF NOT EXISTS document_audit_entries_document_hash_idx
    ON document_audit_entries (document_id, entry_hash);
  CREATE INDEX IF NOT EXISTS document_audit_entries_document_created_idx
    ON document_audit_entries (document_id, created_at);
  CREATE INDEX IF NOT EXISTS attachment_bindings_document_idx
    ON attachment_bindings (document_id);
  CREATE INDEX IF NOT EXISTS attachment_bindings_blob_idx
    ON attachment_bindings (blob_id);
  CREATE INDEX IF NOT EXISTS attachment_bindings_previous_binding_id_idx
    ON attachment_bindings (previous_binding_id);
  CREATE UNIQUE INDEX IF NOT EXISTS attachment_bindings_document_slot_active_idx
    ON attachment_bindings (document_id, slot_id) WHERE detached_at IS NULL;
  ${loroSql}
`);

export default client;
