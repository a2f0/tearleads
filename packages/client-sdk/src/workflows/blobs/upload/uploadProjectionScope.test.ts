import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { createBlobAttachmentServiceFixture } from "../../../../test/helpers/workflows/blobAttachmentServiceFixture";
import {
  createExpiringApiServer,
  SCOPE_RETIREMENTS,
} from "../../../../test/helpers/workflows/expiringApiServer";
import { createMaterializedSyncFixture } from "../../../../test/helpers/workflows/materializedSyncFixture";
import type { BlobBytes } from "../../../data/blobs/blobContracts";

test.each(SCOPE_RETIREMENTS)(
  "an attachment's projection read that expires after %s does not renew",
  async (change) => {
    const { author, resolveProjectionUserKey, secretKey, writerProjection } =
      await createMaterializedSyncFixture();
    const server = createExpiringApiServer({
      method: "GET",
      path: /^\/documents\/[^/]+\/writer-projection$/,
    });
    const { close, execSql } = await createTestExecSql(
      `attachment-projection-scope-${change}`,
    );
    let stages = 0;
    let current = true;
    try {
      const uploaded = createBlobAttachmentServiceFixture({
        api: {
          getDocumentWriterProjection: server.api.getDocumentWriterProjection,
          initiateMultipartBlobStage: async () => {
            stages += 1;
            return null;
          },
        },
        encapsulationSecretKey: secretKey,
        execSql,
      }).uploadDocumentAttachment({
        author,
        bytes: new Uint8Array([1, 2, 3]) as BlobBytes,
        documentId: writerProjection.documentId,
        expectedBindingId: null,
        resolveProjectionUserKey,
        slotId: "scoped-projection",
        stillCurrent: () => current,
      });
      await server.entered;
      current = false;
      server.retire(change);
      server.release();
      expect(await uploaded).toBeNull();
      expect(server.requests).toEqual([
        `GET /documents/${writerProjection.documentId}/writer-projection`,
      ]);
      expect(server.renewals.count).toBe(0);
      expect(stages).toBe(0);
    } finally {
      server.stop();
      close();
    }
  },
);
