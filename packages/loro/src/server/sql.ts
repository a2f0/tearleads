export const loroSql = `
  CREATE TABLE IF NOT EXISTS documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
