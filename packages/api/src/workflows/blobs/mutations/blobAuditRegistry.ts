import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import {
  type BlobAuditRetentionMode,
  blobAuditObjects,
  blobs,
} from "@tearleads/api-shared/schema";
import { inArray } from "drizzle-orm";
import { uniqueSortedStrings } from "../../../utils/array";

const BLOB_AUDIT_RETENTION_MODE_LIVE_ONLY: BlobAuditRetentionMode = "live_only";

async function loadRegisteredBlobOrganizations(
  executor: DatabaseTransaction,
  blobIds: readonly string[],
) {
  return executor
    .select({
      blobId: blobAuditObjects.blobId,
      organizationId: blobAuditObjects.organizationId,
    })
    .from(blobAuditObjects)
    .where(inArray(blobAuditObjects.blobId, [...blobIds]));
}

/**
 * Register every blob an attachment bind, replace, or detach references in
 * `blob_audit_objects` before live blob pruning can remove its row. The
 * registry pins the owning organization for GC, blob authorization, and
 * organization purge; a blob already registered to another organization is
 * refused, including when a concurrent first registration wins the insert.
 */
export async function registerAttachmentBlobs(input: {
  readonly blobIds: readonly (string | null)[];
  readonly executor: DatabaseTransaction;
  readonly organizationId: string;
}): Promise<void> {
  const blobIds = uniqueSortedStrings(
    input.blobIds.filter((blobId): blobId is string => blobId !== null),
  );
  if (blobIds.length === 0) {
    return;
  }

  const existingRows = await loadRegisteredBlobOrganizations(
    input.executor,
    blobIds,
  );
  if (existingRows.some((row) => row.organizationId !== input.organizationId)) {
    throw new Error("Blob audit organization does not match document");
  }
  const existingBlobIds = new Set(existingRows.map((row) => row.blobId));
  const missingBlobIds = blobIds.filter(
    (blobId) => !existingBlobIds.has(blobId),
  );
  if (missingBlobIds.length === 0) {
    return;
  }

  const liveBlobRows = await input.executor
    .select({
      blobId: blobs.id,
      byteLength: blobs.byteLength,
      liveStorageKey: blobs.storageKey,
      sha256: blobs.sha256,
    })
    .from(blobs)
    .where(inArray(blobs.id, missingBlobIds));
  if (liveBlobRows.length !== missingBlobIds.length) {
    throw new Error(
      `Missing live blob rows for audit metadata: ${missingBlobIds.join(", ")}`,
    );
  }

  await input.executor
    .insert(blobAuditObjects)
    .values(
      liveBlobRows.map((blob) => ({
        blobId: blob.blobId,
        byteLength: blob.byteLength,
        historicalBytesRetained: false,
        liveStorageKey: blob.liveStorageKey,
        organizationId: input.organizationId,
        prunedAt: null,
        retentionMode: BLOB_AUDIT_RETENTION_MODE_LIVE_ONLY,
        sha256: blob.sha256,
      })),
    )
    .onConflictDoNothing({ target: blobAuditObjects.blobId });

  // Validate the conflict winner too: concurrent first registration must
  // never let one blob generation acquire ownership in two organizations.
  const storedRows = await loadRegisteredBlobOrganizations(
    input.executor,
    blobIds,
  );
  if (
    storedRows.length !== blobIds.length ||
    storedRows.some((row) => row.organizationId !== input.organizationId)
  ) {
    throw new Error("Blob audit organization does not match document");
  }
}
