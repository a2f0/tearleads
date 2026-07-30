import { loroServerSchemaDialect } from "./columns";

const postgresLoroSql = `
  CREATE TABLE IF NOT EXISTS documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attribution_revision INTEGER NOT NULL DEFAULT 0,
    attribution_incarnation UUID NOT NULL DEFAULT gen_random_uuid(),
    created_by_fingerprint TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS documents_updated_at_id_idx
    ON documents (updated_at, id);
  CREATE TABLE IF NOT EXISTS document_updates (
    sequence INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id UUID NOT NULL UNIQUE,
    document_id UUID NOT NULL,
    access_epoch INTEGER NOT NULL,
    author_fingerprint TEXT NOT NULL,
    encrypted_data TEXT NOT NULL,
    byte_length INTEGER NOT NULL,
    partial_start_version_vector TEXT NOT NULL,
    partial_end_version_vector TEXT NOT NULL,
    plaintext_hash TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS document_update_spans (
    document_id UUID NOT NULL,
    update_id UUID NOT NULL,
    peer_id TEXT NOT NULL,
    start_counter INTEGER NOT NULL,
    end_counter INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS document_update_spans_peer_counter_idx
    ON document_update_spans (document_id, peer_id, end_counter);
  CREATE UNIQUE INDEX IF NOT EXISTS document_update_spans_update_peer_idx
    ON document_update_spans (update_id, peer_id);
`;

const sqliteNow = "cast((julianday('now') - 2440587.5)*86400000 as integer)";

const sqliteLoroSql = `
  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    attribution_revision INTEGER NOT NULL DEFAULT 0,
    attribution_incarnation TEXT NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    created_by_fingerprint TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (${sqliteNow}),
    updated_at INTEGER NOT NULL DEFAULT (${sqliteNow})
  );
  CREATE INDEX IF NOT EXISTS documents_updated_at_id_idx
    ON documents (updated_at, id);
  CREATE TABLE IF NOT EXISTS document_updates (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    document_id TEXT NOT NULL,
    access_epoch INTEGER NOT NULL,
    author_fingerprint TEXT NOT NULL,
    encrypted_data TEXT NOT NULL,
    byte_length INTEGER NOT NULL,
    partial_start_version_vector TEXT NOT NULL,
    partial_end_version_vector TEXT NOT NULL,
    plaintext_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (${sqliteNow})
  );
  CREATE TABLE IF NOT EXISTS document_update_spans (
    document_id TEXT NOT NULL,
    update_id TEXT NOT NULL,
    peer_id TEXT NOT NULL,
    start_counter INTEGER NOT NULL,
    end_counter INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS document_update_spans_peer_counter_idx
    ON document_update_spans (document_id, peer_id, end_counter);
  CREATE UNIQUE INDEX IF NOT EXISTS document_update_spans_update_peer_idx
    ON document_update_spans (update_id, peer_id);
`;

export const loroSql =
  loroServerSchemaDialect === "sqlite" ? sqliteLoroSql : postgresLoroSql;
