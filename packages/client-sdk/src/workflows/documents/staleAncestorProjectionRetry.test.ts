import { expect, test } from "bun:test";
import { createMockApiClient } from "@tearleads/test-utils";
import {
  createBlobAttachmentBindResponse,
  createMultipartBlobStageFixture,
} from "../../../test/helpers/blobUploadFixtures";
import { createPendingUpdateRecord } from "../../../test/helpers/documentResponseFixtures";
import { repairedAncestorDocument } from "../../../test/helpers/repairedAncestorDocument";
import type { BlobBytes } from "../../data/blobContracts";
import { ContainerKekRepairRequiredError } from "../../data/documents/shared/containerKekCurrency";
import { uploadDocumentAttachment } from "../blobs/upload";
import { retrySyncPlan } from "./syncFailures";
import { buildMaterializedDocumentSyncPlan } from "./syncPlanMaterial";

for (const peerRepaired of [true, false]) {
  test(`sync refreshes a cached stale ancestor once (peer repaired: ${peerRepaired})`, async () => {
    const { database, input, projection, repairedProjection } =
      await repairedAncestorDocument();
    let evictions = 0;
    let reads = 0;
    let builds = 0;
    try {
      const planned = retrySyncPlan({
        apiClient: createMockApiClient({
          evictDocumentWriterProjection: () => {
            evictions += 1;
          },
          getDocumentWriterProjection: async () => {
            reads += 1;
            return peerRepaired ? repairedProjection : projection;
          },
        }),
        buildWithProjection: async (writerProjection) => {
          builds += 1;
          return buildMaterializedDocumentSyncPlan({
            ...input,
            localVersionVector: null,
            pendingUpdates: [createPendingUpdateRecord()],
            writerProjection,
          });
        },
        documentId: projection.documentId,
        writerProjection: projection,
      });
      if (peerRepaired) {
        const result = await planned;
        expect(result?.[0].plan.request.outgoingUpdates).toHaveLength(1);
        expect(result?.[1]).toBe(repairedProjection);
      } else {
        await expect(planned).rejects.toBeInstanceOf(
          ContainerKekRepairRequiredError,
        );
      }
      expect(evictions).toBe(1);
      expect(reads).toBe(1);
      expect(builds).toBe(2);
    } finally {
      database.close();
    }
  });

  test(`attachment refreshes a cached stale ancestor once (peer repaired: ${peerRepaired})`, async () => {
    const { database, input, projection, repairedProjection } =
      await repairedAncestorDocument();
    let evictions = 0;
    let reads = 0;
    let stages = 0;
    const multipart = createMultipartBlobStageFixture();
    try {
      const upload = uploadDocumentAttachment({
        ...input,
        apiClient: {
          ...multipart,
          bindBlobAttachment: async (blobId, request) =>
            createBlobAttachmentBindResponse({
              blobId,
              documentManifest: repairedProjection.documentManifest,
              request,
            }),
          evictDocumentWriterProjection: () => {
            evictions += 1;
          },
          getDocumentWriterProjection: async () => {
            reads += 1;
            return peerRepaired ? repairedProjection : projection;
          },
          initiateMultipartBlobStage: async (request) => {
            stages += 1;
            return multipart.initiateMultipartBlobStage(request);
          },
        },
        bytes: new Uint8Array([1, 2, 3]) as BlobBytes,
        documentId: projection.documentId,
        expectedBindingId: null,
        slotId: "preview",
        writerProjection: projection,
      });
      if (peerRepaired) {
        expect((await upload)?.writerProjection).toBe(repairedProjection);
      } else {
        await expect(upload).rejects.toBeInstanceOf(
          ContainerKekRepairRequiredError,
        );
      }
      expect(evictions).toBe(1);
      expect(reads).toBe(1);
      expect(stages).toBe(peerRepaired ? 1 : 0);
    } finally {
      database.close();
    }
  });
}
