import { PGlite } from "@electric-sql/pglite";
import { loroSql } from "@tearleads/loro/server";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../schema";

const client = new PGlite({ debug: 0 });
export const db = drizzle({ client, schema });
export type DatabaseTransaction = Parameters<
  (typeof db)["transaction"]
>[0] extends (tx: infer T) => Promise<unknown>
  ? T
  : never;
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
  CREATE TABLE IF NOT EXISTS organization_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,
    user_id UUID NOT NULL,
    role TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS group_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID NOT NULL,
    user_id UUID NOT NULL,
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
    members_json TEXT NOT NULL,
    membership_root TEXT NOT NULL,
    state_hash TEXT NOT NULL,
    signed_at TIMESTAMP NOT NULL,
    signer_key_id TEXT NOT NULL,
    signature TEXT NOT NULL,
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
  CREATE INDEX IF NOT EXISTS organization_members_organization_id_idx
    ON organization_members (organization_id);
  CREATE INDEX IF NOT EXISTS group_members_group_id_idx
    ON group_members (group_id);
  CREATE INDEX IF NOT EXISTS principal_states_principal_idx
    ON principal_states (principal_type, principal_id);
  CREATE UNIQUE INDEX IF NOT EXISTS principal_states_principal_version_idx
    ON principal_states (principal_type, principal_id, version);
  CREATE UNIQUE INDEX IF NOT EXISTS principal_states_principal_state_hash_idx
    ON principal_states (principal_type, principal_id, state_hash);
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
  CREATE UNIQUE INDEX IF NOT EXISTS document_container_links_document_container_idx
    ON document_container_links (document_id, container_id);
  CREATE INDEX IF NOT EXISTS document_container_links_container_idx
    ON document_container_links (container_id);
  CREATE INDEX IF NOT EXISTS attachment_bindings_document_idx
    ON attachment_bindings (document_id);
  CREATE INDEX IF NOT EXISTS attachment_bindings_blob_idx
    ON attachment_bindings (blob_id);
  CREATE UNIQUE INDEX IF NOT EXISTS attachment_bindings_document_slot_active_idx
    ON attachment_bindings (document_id, slot_id) WHERE detached_at IS NULL;
  ${loroSql}
`);

export default client;
