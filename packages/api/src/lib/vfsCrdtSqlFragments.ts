export const VFS_CRDT_CLIENT_PUSH_SOURCE_TABLE = 'vfs_crdt_client_push';

export const VFS_CRDT_SOURCE_ID_REPLICA_ID_SQL = `split_part(source_id, ':', 2)`;

export const VFS_CRDT_SOURCE_ID_SAFE_WRITE_ID_SQL = `
CASE
  WHEN split_part(source_id, ':', 3) ~ '^[0-9]+$'
    AND (
      length(split_part(source_id, ':', 3)) < 19
      OR (
        length(split_part(source_id, ':', 3)) = 19
        AND split_part(source_id, ':', 3) <= '9223372036854775807'
      )
    )
    THEN split_part(source_id, ':', 3)::bigint
  ELSE NULL
END
`;
