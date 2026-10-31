import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { blobStages } from "@tearleads/api-shared/schema";
import { and, eq, inArray, lte } from "drizzle-orm";
import { lockRowForUpdate } from "../../utils/sqlDialect";
import { assertBlobStorageKeyOrganization } from "./storageKeys";

type BlobStageAccessStatus = 403 | 404 | 409;

export interface OwnedActiveBlobStage {
  readonly byteLength: number;
  readonly completedAt: Date | null;
  readonly expiresAt: Date;
  readonly id: string;
  readonly ownerUserId: string;
  readonly organizationId: string;
  readonly sha256: string;
  readonly storageKey: string;
  readonly uploadId: string;
}

export async function loadOwnedActiveBlobStage(
  executor: DatabaseSession,
  input: {
    readonly error: (message: string, status: BlobStageAccessStatus) => Error;
    readonly lockForUpdate?: boolean;
    readonly stageId: string;
    readonly userId: string;
  },
): Promise<OwnedActiveBlobStage> {
  const query = executor
    .select({
      byteLength: blobStages.byteLength,
      completedAt: blobStages.completedAt,
      expiresAt: blobStages.expiresAt,
      id: blobStages.id,
      ownerUserId: blobStages.ownerUserId,
      organizationId: blobStages.organizationId,
      sha256: blobStages.sha256,
      storageKey: blobStages.storageKey,
      uploadId: blobStages.uploadId,
    })
    .from(blobStages)
    .where(eq(blobStages.id, input.stageId))
    .limit(1);
  const [stage] = await (input.lockForUpdate ? lockRowForUpdate(query) : query);

  if (!stage) {
    throw input.error("Blob stage not found", 404);
  }
  if (stage.ownerUserId !== input.userId) {
    throw input.error("Forbidden", 403);
  }
  if (stage.expiresAt.getTime() <= Date.now()) {
    throw input.error("Blob stage has expired", 409);
  }

  assertBlobStorageKeyOrganization(stage.storageKey, stage.organizationId);
  return stage;
}

/**
 * Serialize expiry against promotion before touching object storage. Promotion
 * holds a stage row until commit; if it wins, the UPDATE returns no row for that
 * stage. If cleanup wins, the durable expiry prevents later binds, even if
 * object-store cleanup fails or the process restarts. One statement claims the
 * whole batch, and no DB lock is held across network I/O. Callers check each
 * returned stage's storage key, so one bad row fails only its own cleanup.
 */
export async function expireBlobStagesForCleanup(
  executor: DatabaseSession,
  input: { readonly now: Date; readonly stageIds: readonly string[] },
): Promise<OwnedActiveBlobStage[]> {
  if (input.stageIds.length === 0) return [];
  return executor
    .update(blobStages)
    .set({ expiresAt: new Date(0) })
    .where(
      and(
        inArray(blobStages.id, [...input.stageIds]),
        lte(blobStages.expiresAt, input.now),
      ),
    )
    .returning();
}
