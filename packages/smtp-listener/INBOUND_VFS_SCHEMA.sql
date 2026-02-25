-- Proposed schema for greenfield inbound SMTP -> VFS integration.
-- Not applied yet. Intended as implementation-ready draft for issue #2231.

CREATE TABLE IF NOT EXISTS email_messages (
  id TEXT PRIMARY KEY,
  storage_key TEXT NOT NULL UNIQUE,
  sha256 TEXT NOT NULL,
  ciphertext_size INTEGER NOT NULL CHECK (ciphertext_size >= 0),
  ciphertext_content_type TEXT NOT NULL DEFAULT 'message/rfc822',
  content_encryption_algorithm TEXT NOT NULL DEFAULT 'aes-256-gcm',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Optional: junction table for explicit folder placement bookkeeping if needed
-- outside existing VFS tables.
CREATE TABLE IF NOT EXISTS email_delivery_targets (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES email_messages(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  folder_id TEXT NOT NULL REFERENCES email_folders(id) ON DELETE CASCADE,
  vfs_item_id TEXT NOT NULL REFERENCES vfs_registry(id) ON DELETE CASCADE,
  delivered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS email_delivery_targets_folder_idx
  ON email_delivery_targets (folder_id, delivered_at DESC);
