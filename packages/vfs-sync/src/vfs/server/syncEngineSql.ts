export const VFS_SYNC_SQL = `
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
      owner_items AS (
        SELECT
          registry.id AS item_id,
          3 AS access_rank
        FROM vfs_registry registry
        WHERE registry.owner_id = $1
      ),
      acl_items AS (
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
      ),
      eligible_items AS (
        SELECT
          candidate.item_id,
          MAX(candidate.access_rank) AS access_rank
        FROM (
          SELECT item_id, access_rank FROM owner_items
          UNION ALL
          SELECT item_id, access_rank FROM acl_items
        ) candidate
        GROUP BY candidate.item_id
      ),
      visible_changes AS (
        SELECT
          change_row.id AS change_id,
          change_row.item_id,
          change_row.change_type,
          change_row.changed_at
        FROM vfs_sync_changes change_row
        INNER JOIN eligible_items access ON access.item_id = change_row.item_id
        WHERE (
          $2::timestamptz IS NULL
          OR change_row.changed_at > $2::timestamptz
          OR (
            change_row.changed_at = $2::timestamptz
            AND change_row.id > COALESCE($3::text, '')
          )
        )
          AND (
            $5::text IS NULL
            OR change_row.item_id = $5::text
            OR EXISTS (
              SELECT 1
              FROM vfs_links link
              WHERE link.parent_id = $5::text
                AND link.child_id = change_row.item_id
            )
          )
        ORDER BY change_row.changed_at ASC, change_row.id ASC
        LIMIT $4::integer
      )
      SELECT
        visible_changes.change_id,
        visible_changes.item_id,
        visible_changes.change_type,
        visible_changes.changed_at,
        registry.object_type,
        registry.encrypted_name,
        registry.owner_id,
        registry.created_at,
        CASE access.access_rank
          WHEN 3 THEN 'admin'
          WHEN 2 THEN 'write'
          ELSE 'read'
        END AS access_level
      FROM visible_changes
      INNER JOIN eligible_items access ON access.item_id = visible_changes.item_id
      LEFT JOIN vfs_registry registry ON registry.id = visible_changes.item_id
      ORDER BY visible_changes.changed_at ASC, visible_changes.change_id ASC
      `;
