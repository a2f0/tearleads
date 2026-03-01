/**
 * VFS Sync SQL (Optimized)
 *
 * Invariants:
 * 1. visibility is pre-materialized in vfs_effective_visibility (denormalized).
 * 2. vfs_sync_changes includes parent_id to optimize scoped sync feeds.
 * 3. ordering is deterministic (changed_at, id).
 */
export const VFS_SYNC_SQL = `
      WITH visible_changes AS (
        SELECT
          change_row.id AS change_id,
          change_row.item_id,
          change_row.change_type,
          change_row.changed_at,
          access.access_rank
        FROM vfs_sync_changes change_row
        INNER JOIN vfs_effective_visibility access 
           ON access.item_id = change_row.item_id
          AND access.user_id = $1
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
          OR change_row.parent_id = $5::text
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
        CASE visible_changes.access_rank
          WHEN 3 THEN 'admin'
          WHEN 2 THEN 'write'
          ELSE 'read'
        END AS access_level
      FROM visible_changes
      LEFT JOIN vfs_registry registry ON registry.id = visible_changes.item_id
      ORDER BY visible_changes.changed_at ASC, visible_changes.change_id ASC
      `;
