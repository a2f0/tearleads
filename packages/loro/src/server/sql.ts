export const loroSql = `
  CREATE TABLE IF NOT EXISTS documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_by_fingerprint TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS document_updates (
    sequence INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id UUID NOT NULL UNIQUE,
    document_id UUID NOT NULL,
    author_fingerprint TEXT NOT NULL,
    encrypted_data TEXT NOT NULL,
    partial_start_version_vector TEXT NOT NULL,
    partial_end_version_vector TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now()
  );
`;
