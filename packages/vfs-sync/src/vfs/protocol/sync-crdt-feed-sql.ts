export const VFS_CRDT_SYNC_SQL = `
      WITH visible_ops AS (
        SELECT
          ops.id AS op_id,
          ops.item_id,
          ops.op_type,
          ops.principal_type,
          ops.principal_id,
          ops.access_level,
          ops.parent_id,
          ops.child_id,
          ops.actor_id,
          ops.source_table,
          ops.source_id,
          ops.occurred_at,
          ops.encrypted_payload,
          ops.key_epoch,
          ops.encryption_nonce,
          ops.encryption_aad,
          ops.encryption_signature
        FROM vfs_crdt_ops ops
        INNER JOIN vfs_effective_visibility access 
           ON access.item_id = ops.item_id
          AND access.user_id = $1
        WHERE (
          $2::timestamptz IS NULL
          OR ops.occurred_at > $2::timestamptz
          OR (
            ops.occurred_at = $2::timestamptz
            AND ops.id > COALESCE($3::text, '')
          )
        )
        AND (
          $5::text IS NULL
          OR ops.item_id = $5::text
          OR EXISTS (
            SELECT 1 FROM vfs_links 
            WHERE parent_id = $5::text 
              AND child_id = ops.item_id
          )
        )
        ORDER BY ops.occurred_at ASC, ops.id ASC
        LIMIT $4::integer
      )
      SELECT
        op_id,
        item_id,
        op_type,
        principal_type,
        principal_id,
        access_level,
        parent_id,
        child_id,
        actor_id,
        source_table,
        source_id,
        occurred_at,
        encrypted_payload,
        key_epoch,
        encryption_nonce,
        encryption_aad,
        encryption_signature
      FROM visible_ops
      ORDER BY occurred_at ASC, op_id ASC
      `;
