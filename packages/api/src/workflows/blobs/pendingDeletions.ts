import type {
  ApiDatabase,
  DatabaseSession,
} from "@tearleads/api-shared/postgres";
import {
  attachmentBindings,
  blobAuditObjects,
  blobs,
} from "@tearleads/api-shared/schema";
import type { PendingBlobDeletion } from "@tearleads/validators/response";
import {
  and,
  asc,
  eq,
  gt,
  isNotNull,
  isNull,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import { wallClockNowExpression } from "../../utils/postgresSql";
import { requireDirectOrganizationAccess } from "../organizations/access";
import { DEFAULT_BLOB_GC_GRACE_PERIOD_MS } from "./gc/gracePeriod";

interface PendingDeletionPageInput {
  readonly afterId?: string | undefined;
  readonly limit: number;
  readonly access:
    | { readonly kind: "root"; readonly organizationId?: string | undefined }
    | {
        readonly kind: "organization";
        readonly organizationId: string;
        readonly userId: string;
      };
}

export interface PendingBlobDeletionPage {
  readonly blobs: PendingBlobDeletion[];
  readonly afterId: string | null;
}

async function loadPendingDeletions(
  executor: DatabaseSession,
  input: PendingDeletionPageInput,
): Promise<PendingBlobDeletionPage> {
  const limit = Math.min(100, Math.max(1, Math.trunc(input.limit)));
  const { organizationId } = input.access;
  // The durable registry owns identity and organization even after live pruning.
  // A single snapshot and one id ordering spans both lifecycle phases, so a
  // transition does not move an item to a different pagination lane.
  const rows = await executor
    .select({
      blobId: blobAuditObjects.blobId,
      organizationId: blobAuditObjects.organizationId,
      byteLength: blobAuditObjects.byteLength,
      dereferencedAt: blobs.dereferencedAt,
      reclaimAttemptedAt: blobs.reclaimAttemptedAt,
      prunedAt: blobAuditObjects.prunedAt,
      objectDeleteAttemptedAt: blobAuditObjects.objectDeleteAttemptedAt,
      status: sql<PendingBlobDeletion["status"]>`case
        when ${blobs.id} is null then 'deletion-pending'
        when ${blobs.dereferencedAt} + ${DEFAULT_BLOB_GC_GRACE_PERIOD_MS} * interval '1 millisecond' <= ${wallClockNowExpression()} then 'eligible'
        else 'grace-period' end`,
    })
    .from(blobAuditObjects)
    .leftJoin(blobs, eq(blobs.id, blobAuditObjects.blobId))
    .where(
      and(
        organizationId === undefined
          ? undefined
          : eq(blobAuditObjects.organizationId, organizationId),
        input.afterId === undefined
          ? undefined
          : gt(blobAuditObjects.blobId, input.afterId),
        isNull(blobAuditObjects.objectDeletedAt),
        notExists(
          executor
            .select({ id: attachmentBindings.id })
            .from(attachmentBindings)
            .where(
              and(
                eq(attachmentBindings.blobId, blobAuditObjects.blobId),
                isNull(attachmentBindings.detachedAt),
              ),
            ),
        ),
        or(
          and(
            isNotNull(blobs.dereferencedAt),
            isNull(blobAuditObjects.prunedAt),
          ),
          and(
            isNull(blobs.id),
            isNotNull(blobAuditObjects.prunedAt),
            isNotNull(blobAuditObjects.liveStorageKey),
          ),
        ),
      ),
    )
    .orderBy(asc(blobAuditObjects.blobId))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  return {
    blobs: page.map((row) => ({
      blobId: row.blobId,
      organizationId: row.organizationId,
      byteLength: row.byteLength,
      status: row.status,
      dereferencedAt: row.dereferencedAt?.toISOString() ?? null,
      eligibleAfter:
        row.dereferencedAt === null
          ? null
          : new Date(
              row.dereferencedAt.getTime() + DEFAULT_BLOB_GC_GRACE_PERIOD_MS,
            ).toISOString(),
      reclaimAttemptedAt: row.reclaimAttemptedAt?.toISOString() ?? null,
      prunedAt: row.prunedAt?.toISOString() ?? null,
      objectDeleteAttemptedAt:
        row.objectDeleteAttemptedAt?.toISOString() ?? null,
    })),
    afterId: rows.length > limit ? (page.at(-1)?.blobId ?? null) : null,
  };
}

export async function runListPendingBlobDeletionsWorkflow(
  db: ApiDatabase,
  input: PendingDeletionPageInput,
) {
  return db.transaction(
    async (tx) => {
      if (input.access.kind === "organization") {
        await requireDirectOrganizationAccess({
          executor: tx,
          organizationId: input.access.organizationId,
          requireAdmin: true,
          userId: input.access.userId,
        });
      }
      return loadPendingDeletions(tx, input);
    },
    { accessMode: "read only", isolationLevel: "repeatable read" },
  );
}
