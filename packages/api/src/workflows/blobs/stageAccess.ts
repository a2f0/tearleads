import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { blobStages } from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";

type BlobStageAccessStatus = 403 | 404 | 409;

export interface OwnedActiveBlobStage {
  readonly byteLength: number;
  readonly completedAt: Date | null;
  readonly expiresAt: Date;
  readonly id: string;
  readonly ownerUserId: string;
  readonly sha256: string;
  readonly storageKey: string;
  readonly uploadId: string;
}

export async function loadOwnedActiveBlobStage(
  executor: DatabaseSession,
  input: {
    readonly error: (message: string, status: BlobStageAccessStatus) => Error;
    readonly stageId: string;
    readonly userId: string;
  },
): Promise<OwnedActiveBlobStage> {
  const [stage] = await executor
    .select({
      byteLength: blobStages.byteLength,
      completedAt: blobStages.completedAt,
      expiresAt: blobStages.expiresAt,
      id: blobStages.id,
      ownerUserId: blobStages.ownerUserId,
      sha256: blobStages.sha256,
      storageKey: blobStages.storageKey,
      uploadId: blobStages.uploadId,
    })
    .from(blobStages)
    .where(eq(blobStages.id, input.stageId))
    .limit(1);

  if (!stage) {
    throw input.error("Blob stage not found", 404);
  }
  if (stage.ownerUserId !== input.userId) {
    throw input.error("Forbidden", 403);
  }
  if (stage.expiresAt.getTime() <= Date.now()) {
    throw input.error("Blob stage has expired", 409);
  }

  return stage;
}
