import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import type { BlobAttachmentDetachRequest } from "@tearleads/validators/request";
import { createBlobAttachmentServiceFixture } from "../../../../test/helpers/workflows/blobAttachmentServiceFixture";
import { createMaterializedSyncFixture } from "../../../../test/helpers/workflows/materializedSyncFixture";

const cursor = "550e8400-e29b-41d4-a716-446655440701";

// A detach is checked against the document's committed updates as a bind is,
// so it carries the processed cursor its version covers, and none when no
// cursor qualifies: an update this device voided must not refuse it forever.
test.each([
  [cursor, cursor],
  [undefined, undefined],
] as const)(
  "a detach carries the processed cursor its version covers (%s)",
  async (found, sent) => {
    const { author, resolveProjectionUserKey, writerProjection } =
      await createMaterializedSyncFixture();
    const { close, execSql } = await createTestExecSql(
      "attachment-detach-cursor",
    );
    const asked: unknown[] = [];
    const submitted: BlobAttachmentDetachRequest[] = [];
    try {
      await createBlobAttachmentServiceFixture({
        api: {
          detachBlobAttachment: async (blobId, bindingId, request) => {
            submitted.push(request);
            return {
              bindingId,
              blobId,
              documentId: writerProjection.documentId,
              slotId: "preview",
            };
          },
          getDocumentWriterProjection: async () => writerProjection,
        },
        execSql,
        processedCursorFor: async (input) => {
          asked.push(input);
          return found;
        },
      }).detachDocumentAttachment({
        author,
        bindingId: "550e8400-e29b-41d4-a716-446655440702",
        blobId: "550e8400-e29b-41d4-a716-446655440703",
        documentId: writerProjection.documentId,
        documentVersionVector: "document-version-vector",
        resolveProjectionUserKey,
        slotId: "preview",
      });
    } finally {
      close();
    }
    expect(asked).toEqual([
      {
        documentId: writerProjection.documentId,
        version: "document-version-vector",
      },
    ]);
    expect(submitted).toHaveLength(1);
    expect(submitted[0]?.processedThroughUpdateId).toBe(sent);
    expect(
      submitted[0] !== undefined && "processedThroughUpdateId" in submitted[0],
    ).toBe(sent !== undefined);
  },
);
