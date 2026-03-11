import { randomUUID } from 'node:crypto';
import { Code, ConnectError } from '@connectrpc/connect';
import { VFS_V2_CONNECT_BASE_PATH } from '@tearleads/shared';
import {
  compareVfsSyncCursorOrder,
  parseVfsCrdtLastReconciledWriteIds,
  type VfsSyncCursor
} from '@tearleads/vfs-sync/vfs';
import type { PoolClient } from 'pg';
import { getPostgresPool } from '../../lib/postgres.js';
import { requireVfsClaims } from './vfsDirectAuth.js';
import {
  dominatesLastWriteIds,
  parseBlobAttachConsistency,
  parseBlobLinkRelationKind,
  parseBlobLinkRelationKindFromSessionKey,
  toBlobLinkSessionKey,
  toScopedCrdtClientId
} from './vfsDirectBlobAttachHelpers.js';
import {
  type AttachBlobRequest,
  normalizeRequiredString,
  parseBlobAttachBody,
  toIsoFromDateOrString
} from './vfsDirectBlobShared.js';
export type AttachBlobDirectResponse = {
  attached: boolean;
  stagingId: string;
  blobId: string;
  itemId: string;
  relationKind: string;
  refId: string;
  attachedAt: string;
};

interface BlobStagingRow {
  blob_id: string;
  staged_by: string | null;
  organization_id: string | null;
  status: string;
  expires_at: Date | string | null;
}

interface CrdtReconcileStateRow {
  last_reconciled_at: Date | string;
  last_reconciled_change_id: string;
  last_reconciled_write_ids: unknown;
}

interface BlobRegistryRow {
  object_type: string;
  organization_id: string | null;
}

interface BlobLinkRow {
  id: string;
  created_at: Date | string;
  wrapped_session_key: string | null;
  visible_children: unknown;
}

async function rollbackQuietly(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // no-op
  }
}

function requireStagingId(value: string): string {
  const stagingId = normalizeRequiredString(value);
  if (!stagingId) {
    throw new ConnectError('stagingId is required', Code.InvalidArgument);
  }

  return stagingId;
}

export async function attachBlobDirect(
  request: AttachBlobRequest,
  context: { requestHeader: Headers }
): Promise<AttachBlobDirectResponse> {
  const stagingId = requireStagingId(request.stagingId);
  const claims = await requireVfsClaims(
    `${VFS_V2_CONNECT_BASE_PATH}/AttachBlob`,
    context.requestHeader,
    { requireDeclaredOrganization: true }
  );

  const parsedBody = parseBlobAttachBody(request);
  if (!parsedBody) {
    throw new ConnectError('itemId is required', Code.InvalidArgument);
  }

  const parsedConsistency = parseBlobAttachConsistency(request);
  if (!parsedConsistency.ok) {
    throw new ConnectError(parsedConsistency.error, Code.InvalidArgument);
  }

  const pool = await getPostgresPool();
  const client = await pool.connect();
  let inTransaction = false;

  try {
    await client.query('BEGIN');
    inTransaction = true;

    const stagedResult = await client.query<BlobStagingRow>(
      `
      SELECT
        stage_link.child_id AS blob_id,
        stage_registry.owner_id AS staged_by,
        stage_registry.organization_id AS organization_id,
        CASE stage_link.wrapped_session_key
          WHEN 'blob-stage:staged' THEN 'staged'
          WHEN 'blob-stage:attached' THEN 'attached'
          WHEN 'blob-stage:abandoned' THEN 'abandoned'
          ELSE 'invalid'
        END AS status,
        (stage_link.visible_children ->> 'expiresAt')::timestamptz AS expires_at
      FROM vfs_registry AS stage_registry
      INNER JOIN vfs_links AS stage_link
        ON stage_link.id = stage_registry.id
       AND stage_link.parent_id = stage_registry.id
      WHERE stage_registry.id = $1::text
        AND stage_registry.object_type = 'blobStage'
      FOR UPDATE OF stage_registry, stage_link
      `,
      [stagingId]
    );

    const stagedRow = stagedResult.rows[0];
    if (!stagedRow) {
      await client.query('ROLLBACK');
      inTransaction = false;
      throw new ConnectError('Blob staging not found', Code.NotFound);
    }

    const stagedBlobId = normalizeRequiredString(stagedRow.blob_id);
    const stagedBy = normalizeRequiredString(stagedRow.staged_by);
    if (!stagedBlobId || !stagedBy) {
      await client.query('ROLLBACK');
      inTransaction = false;
      throw new ConnectError('Failed to attach staged blob', Code.Internal);
    }

    if (stagedBy !== claims.sub) {
      await client.query('ROLLBACK');
      inTransaction = false;
      throw new ConnectError('Forbidden', Code.PermissionDenied);
    }

    if (stagedRow.organization_id !== claims.organizationId) {
      throw new ConnectError('Forbidden', Code.PermissionDenied);
    }

    if (stagedRow.status !== 'staged') {
      await client.query('ROLLBACK');
      inTransaction = false;
      throw new ConnectError(
        'Blob staging is no longer attachable',
        Code.AlreadyExists
      );
    }

    if (!stagedRow.expires_at) {
      await client.query('ROLLBACK');
      inTransaction = false;
      throw new ConnectError('Failed to attach staged blob', Code.Internal);
    }

    const expiresAtMs = Date.parse(toIsoFromDateOrString(stagedRow.expires_at));
    if (!Number.isFinite(expiresAtMs)) {
      await client.query('ROLLBACK');
      inTransaction = false;
      throw new ConnectError('Failed to attach staged blob', Code.Internal);
    }

    if (expiresAtMs <= Date.now()) {
      await client.query('ROLLBACK');
      inTransaction = false;
      throw new ConnectError('Blob staging has expired', Code.AlreadyExists);
    }

    if (parsedConsistency.value) {
      const reconcileState = await client.query<CrdtReconcileStateRow>(
        `
        SELECT
          last_reconciled_at,
          last_reconciled_change_id,
          last_reconciled_write_ids
        FROM vfs_sync_client_state
        WHERE user_id = $1::text
          AND client_id = $2::text
        FOR UPDATE
        `,
        [claims.sub, toScopedCrdtClientId(parsedConsistency.value.clientId)]
      );

      const reconcileStateRow = reconcileState.rows[0];
      if (!reconcileStateRow) {
        await client.query('ROLLBACK');
        inTransaction = false;
        throw new ConnectError(
          'Client reconcile state is behind required visibility',
          Code.AlreadyExists
        );
      }

      const reconcileChangedAt = toIsoFromDateOrString(
        reconcileStateRow.last_reconciled_at
      );
      const reconcileChangeId = normalizeRequiredString(
        reconcileStateRow.last_reconciled_change_id
      );
      if (
        !Number.isFinite(Date.parse(reconcileChangedAt)) ||
        !reconcileChangeId
      ) {
        await client.query('ROLLBACK');
        inTransaction = false;
        throw new ConnectError('Failed to attach staged blob', Code.Internal);
      }

      const currentCursor: VfsSyncCursor = {
        changedAt: reconcileChangedAt,
        changeId: reconcileChangeId
      };

      const parsedCurrentLastWriteIds = parseVfsCrdtLastReconciledWriteIds(
        reconcileStateRow.last_reconciled_write_ids
      );
      if (!parsedCurrentLastWriteIds.ok) {
        await client.query('ROLLBACK');
        inTransaction = false;
        throw new ConnectError('Failed to attach staged blob', Code.Internal);
      }

      if (
        compareVfsSyncCursorOrder(
          currentCursor,
          parsedConsistency.value.requiredCursor
        ) < 0 ||
        !dominatesLastWriteIds(
          parsedCurrentLastWriteIds.value,
          parsedConsistency.value.requiredLastReconciledWriteIds
        )
      ) {
        await client.query('ROLLBACK');
        inTransaction = false;
        throw new ConnectError(
          'Client reconcile state is behind required visibility',
          Code.AlreadyExists
        );
      }
    }

    const attachedAtIso = new Date().toISOString();
    const updatedResult = await client.query<{
      blob_id: string;
      attached_at: Date | string;
      attached_item_id: string;
    }>(
      `
      UPDATE vfs_links
      SET wrapped_session_key = 'blob-stage:attached',
          visible_children = jsonb_set(
            jsonb_set(
              jsonb_set(
                COALESCE(vfs_links.visible_children::jsonb, '{}'::jsonb),
                '{status}',
                to_jsonb('attached'::text),
                true
              ),
              '{attachedAt}',
              to_jsonb($2::text),
              true
            ),
            '{attachedItemId}',
            to_jsonb($3::text),
            true
          )::json
      WHERE id = $1::text
        AND wrapped_session_key = 'blob-stage:staged'
      RETURNING
        child_id AS blob_id,
        $2::timestamptz AS attached_at,
        $3::text AS attached_item_id
      `,
      [stagingId, attachedAtIso, parsedBody.itemId]
    );

    const updatedRow = updatedResult.rows[0];
    if (!updatedRow) {
      await client.query('ROLLBACK');
      inTransaction = false;
      throw new ConnectError(
        'Blob staging is no longer attachable',
        Code.AlreadyExists
      );
    }

    await client.query(
      `
      INSERT INTO vfs_registry (
        id,
        object_type,
        owner_id,
        organization_id,
        created_at
      ) VALUES (
        $1::text,
        'file',
        $2::text,
        $3::text,
        NOW()
      )
      ON CONFLICT (id) DO NOTHING
      `,
      [stagedBlobId, claims.sub, claims.organizationId]
    );

    const blobRegistryResult = await client.query<BlobRegistryRow>(
      `
      SELECT object_type, organization_id
      FROM vfs_registry
      WHERE id = $1::text
      LIMIT 1
      `,
      [stagedBlobId]
    );
    const blobRegistryRow = blobRegistryResult.rows[0];
    if (
      !blobRegistryRow ||
      blobRegistryRow.object_type !== 'file' ||
      blobRegistryRow.organization_id !== claims.organizationId
    ) {
      await client.query('ROLLBACK');
      inTransaction = false;
      throw new ConnectError(
        'Blob object id conflicts with existing VFS object',
        Code.AlreadyExists
      );
    }

    const insertedRef = await client.query<{
      id: string;
      created_at: Date | string;
    }>(
      `
      INSERT INTO vfs_links (
        id,
        parent_id,
        child_id,
        wrapped_session_key,
        visible_children,
        created_at
      ) VALUES (
        $1::text,
        $2::text,
        $3::text,
        $4::text,
        $5::json,
        NOW()
      )
      ON CONFLICT (parent_id, child_id) DO NOTHING
      RETURNING id, created_at
      `,
      [
        randomUUID(),
        parsedBody.itemId,
        stagedBlobId,
        toBlobLinkSessionKey(parsedBody.relationKind),
        JSON.stringify({
          relationKind: parsedBody.relationKind,
          attachedBy: claims.sub
        })
      ]
    );

    let refId: string;
    let attachedAt: Date | string;

    const insertedRow = insertedRef.rows[0];
    if (insertedRow) {
      refId = insertedRow.id;
      attachedAt = insertedRow.created_at;
    } else {
      const existingRef = await client.query<BlobLinkRow>(
        `
        SELECT id, created_at, wrapped_session_key, visible_children
        FROM vfs_links
        WHERE parent_id = $1::text
          AND child_id = $2::text
        LIMIT 1
        `,
        [parsedBody.itemId, stagedBlobId]
      );

      const existingRow = existingRef.rows[0];
      if (!existingRow) {
        throw new ConnectError(
          'Failed to persist blob attachment reference',
          Code.Internal
        );
      }

      const existingRelationKind =
        parseBlobLinkRelationKind(existingRow.visible_children) ??
        parseBlobLinkRelationKindFromSessionKey(
          existingRow.wrapped_session_key
        );
      if (!existingRelationKind) {
        await client.query('ROLLBACK');
        inTransaction = false;
        throw new ConnectError('Failed to attach staged blob', Code.Internal);
      }

      if (existingRelationKind !== parsedBody.relationKind) {
        await client.query('ROLLBACK');
        inTransaction = false;
        throw new ConnectError(
          'Blob is already attached with a different relation kind',
          Code.AlreadyExists
        );
      }

      refId = existingRow.id;
      attachedAt = existingRow.created_at;
    }

    const responseAttachedAtIso = toIsoFromDateOrString(attachedAt);
    if (!Number.isFinite(Date.parse(responseAttachedAtIso))) {
      await client.query('ROLLBACK');
      inTransaction = false;
      throw new ConnectError('Failed to attach staged blob', Code.Internal);
    }

    await client.query('COMMIT');
    inTransaction = false;

    return {
      attached: true,
      stagingId,
      blobId: stagedBlobId,
      itemId: parsedBody.itemId,
      relationKind: parsedBody.relationKind,
      refId,
      attachedAt: responseAttachedAtIso
    };
  } catch (error) {
    if (inTransaction) {
      await rollbackQuietly(client);
    }

    if (error instanceof ConnectError) {
      throw error;
    }

    console.error('Failed to attach staged blob:', error);
    throw new ConnectError('Failed to attach staged blob', Code.Internal);
  } finally {
    client.release();
  }
}
