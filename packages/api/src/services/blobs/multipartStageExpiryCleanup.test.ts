import { expect, test } from "bun:test";
import { blobStages } from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";
import {
  blobObjectBytes,
  readBlobObjectText,
} from "../../../test/helpers/blobObjectStore";
import { createBlobStageOwner } from "../../../test/helpers/blobStageOwner";
import {
  completeStageAsBind,
  declaredFirstPart,
} from "../../../test/helpers/blobStageParts";
import { createFakeS3BlobObjectStore } from "../../../test/helpers/fakeS3BlobObjectStore";
import { createServiceTestRuntime } from "../../../test/helpers/serviceRuntime";
import { sha256Hex } from "../../utils/sha256";
import {
  cleanupExpiredBlobStages,
  initiateMultipartBlobStage,
  uploadMultipartBlobPartBytes,
} from "./multipartStage";

test("expired stage cleanup deletes an object assembled after the stage was read as pending", async () => {
  const { store } = createFakeS3BlobObjectStore();
  const runtime = createServiceTestRuntime(undefined, {
    blobObjectStore: store,
  });
  const { userId, organizationId } = await createBlobStageOwner();
  const encryptedBytes = "assembled-before-the-row-flip";
  const metadata = {
    byteLength: new TextEncoder().encode(encryptedBytes).byteLength,
    sha256: await sha256Hex(encryptedBytes),
  };
  const initiated = await initiateMultipartBlobStage(runtime, {
    organizationId,
    ...metadata,
    firstParts: declaredFirstPart(metadata.byteLength),
    userId,
  });
  await uploadMultipartBlobPartBytes(runtime, {
    ...metadata,
    bytes: blobObjectBytes(encryptedBytes),
    partNumber: 1,
    stageId: initiated.stageId,
    uploadId: initiated.uploadId,
    userId,
  });
  await completeStageAsBind(runtime, { stageId: initiated.stageId, userId });

  // A bind that assembled the object but stopped before flipping the row
  // leaves a consumed upload behind a stage that still reads as pending.
  const expiredAt = new Date("2000-01-01T00:00:00.000Z");
  await runtime.db
    .update(blobStages)
    .set({ completedAt: null, expiresAt: expiredAt })
    .where(eq(blobStages.id, initiated.stageId));

  const result = await cleanupExpiredBlobStages(runtime, {
    now: expiredAt,
    organizationId,
  });

  expect(result).toMatchObject({ deletedStages: 1, failedStages: 0 });
  await expect(
    readBlobObjectText(
      runtime.blobObjectStore,
      `organizations/${organizationId}/blob-stages/${initiated.stageId}`,
    ),
  ).resolves.toBeNull();
});
