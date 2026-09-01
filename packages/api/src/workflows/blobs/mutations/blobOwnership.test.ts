import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { blobAuditObjects } from "@tearleads/api-shared/schema";
import type { BlobAttachmentBindRequest } from "@tearleads/validators/request";
import { eq } from "drizzle-orm";
import { assertStoredBlobOrganizationMatches } from "./authorization";
import { promoteStagedBlobIfPresent } from "./persistence";

test("pruned blob ids stay concealed from other organizations", async () => {
  const blobId = crypto.randomUUID();
  const ownerOrganizationId = crypto.randomUUID();
  const probingOrganizationId = crypto.randomUUID();
  await db.insert(blobAuditObjects).values({
    blobId,
    byteLength: 1,
    historicalBytesRetained: false,
    liveStorageKey: `blob-object:${blobId}`,
    organizationId: ownerOrganizationId,
    prunedAt: new Date(),
    retentionMode: "live_only",
    sha256: `sha256:${blobId}`,
  });

  try {
    await expect(
      db.transaction((executor) =>
        assertStoredBlobOrganizationMatches({
          blobId,
          executor,
          expectedOrganizationId: probingOrganizationId,
        }),
      ),
    ).rejects.toMatchObject({ message: "Blob not found", status: 404 });

    const stagedRequest = {
      stagedBlob: { stageId: crypto.randomUUID() },
    } as unknown as BlobAttachmentBindRequest;
    await expect(
      db.transaction((executor) =>
        promoteStagedBlobIfPresent({
          blobId,
          executor,
          expectedOrganizationId: probingOrganizationId,
          prevalidatedMultipartStage: null,
          request: stagedRequest,
          userId: crypto.randomUUID(),
        }),
      ),
    ).rejects.toMatchObject({ message: "Blob not found", status: 404 });

    await expect(
      db.transaction((executor) =>
        promoteStagedBlobIfPresent({
          blobId,
          executor,
          expectedOrganizationId: ownerOrganizationId,
          prevalidatedMultipartStage: null,
          request: stagedRequest,
          userId: crypto.randomUUID(),
        }),
      ),
    ).rejects.toMatchObject({ message: "Blob already exists", status: 409 });
  } finally {
    await db
      .delete(blobAuditObjects)
      .where(eq(blobAuditObjects.blobId, blobId));
  }
});
