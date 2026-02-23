export const VFS_CRDT_SYNC_SQL = `
      WITH principals AS (
        SELECT 'user'::text AS principal_type, $1::text AS principal_id
        UNION ALL
        SELECT 'group'::text AS principal_type, ug.group_id AS principal_id
        FROM user_groups ug
        WHERE ug.user_id = $1
        UNION ALL
        SELECT 'organization'::text AS principal_type, uo.organization_id AS principal_id
        FROM user_organizations uo
        WHERE uo.user_id = $1
      ),
      eligible_items AS (
        SELECT
          entry.item_id,
          MAX(
            CASE entry.access_level
              WHEN 'admin' THEN 3
              WHEN 'write' THEN 2
              ELSE 1
            END
          ) AS access_rank
        FROM vfs_acl_entries entry
        INNER JOIN principals principal
          ON principal.principal_type = entry.principal_type
         AND principal.principal_id = entry.principal_id
        WHERE entry.revoked_at IS NULL
          AND (entry.expires_at IS NULL OR entry.expires_at > NOW())
        GROUP BY entry.item_id
      )
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
      INNER JOIN eligible_items access ON access.item_id = ops.item_id
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
            SELECT 1
            FROM vfs_links link
            WHERE link.parent_id = $5::text
              AND link.child_id = ops.item_id
          )
        )
      ORDER BY ops.occurred_at ASC, ops.id ASC
      LIMIT $4::integer
      `;
