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
          encode(ops.encrypted_payload_bytes, 'base64') AS encrypted_payload,
          ops.key_epoch,
          encode(ops.encryption_nonce_bytes, 'base64') AS encryption_nonce,
          encode(ops.encryption_aad_bytes, 'base64') AS encryption_aad,
          encode(ops.encryption_signature_bytes, 'base64') AS encryption_signature
        FROM vfs_crdt_ops ops
        INNER JOIN vfs_effective_visibility access
           ON access.item_id = ops.item_id
          AND access.user_id = $1::uuid
        WHERE (
          $2::timestamptz IS NULL
          OR ops.occurred_at > $2::timestamptz
          OR (
            ops.occurred_at = $2::timestamptz
            AND ops.id > COALESCE($3::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
          )
        )
        AND (
          $5::text IS NULL
          OR ($5::text <> '' AND (ops.item_id = $5::uuid OR ops.root_id = $5::uuid))
        )
        ORDER BY ops.occurred_at ASC, ops.id ASC
        LIMIT $4::integer
      )
      SELECT
        v.op_id,
        v.item_id,
        v.op_type,
        v.principal_type,
        v.principal_id,
        v.access_level,
        v.parent_id,
        v.child_id,
        v.actor_id,
        v.source_table,
        v.source_id,
        v.occurred_at,
        v.encrypted_payload,
        v.key_epoch,
        v.encryption_nonce,
        v.encryption_aad,
        v.encryption_signature,
        br.blob_id,
        bo.size_bytes AS blob_size_bytes,
        br.relation_kind AS blob_relation_kind
      FROM visible_ops v
      LEFT JOIN LATERAL (
        SELECT blob_id, relation_kind
        FROM vfs_blob_refs
        WHERE item_id = v.item_id
        ORDER BY attached_at DESC
        LIMIT 1
      ) br ON true
      LEFT JOIN vfs_blob_objects bo ON bo.id = br.blob_id
      ORDER BY v.occurred_at ASC, v.op_id ASC
      `;
