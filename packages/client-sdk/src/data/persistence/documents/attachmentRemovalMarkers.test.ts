import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  documentAttachmentBlobProjection,
  documentPendingAttachments,
} from "../../sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../sqlite/sqlitePersistenceRuntime";
import { sqlDocumentsPersistence } from "./documentsPersistence";
import { applyStoredAttachmentRemoval } from "./internal/attachmentStagingPersistence";

for (const storageKey of ["upload-key", "replacement-key"]) {
  test(`pending removal reconciles an existing ${storageKey} row`, async () => {
    const { close, execSql } = await createTestExecSql(
      "removal-marker-conflict",
    );
    try {
      await sqlDocumentsPersistence.ensureSchema(execSql);
      const runtime = getClientSQLitePersistenceRuntime(execSql);
      const row = {
        localId: "local",
        slotId: "slot",
        storageKey: "upload-key",
        byteLength: 1,
        contentSha256: "0".repeat(64),
        mimeType: "text/plain",
      };
      await runtime.db.insert(documentPendingAttachments).values({
        ...row,
        name: "pending.txt",
        createdAt: new Date().toISOString(),
        uploadBlobId: "committed-blob",
        uploadContentKey: "key",
        uploadContentKeyEpoch: 1,
        uploadIv: "iv",
        uploadPlaintextSha256: row.contentSha256,
      });
      await runtime.db.insert(documentAttachmentBlobProjection).values({
        ...row,
        storageKey,
        blobId: null,
        detachedAt: null,
        updatedAt: new Date().toISOString(),
      });
      const removal = runtime.transaction((tx) =>
        applyStoredAttachmentRemoval({
          localId: "local",
          removal: { mode: "detach", slotId: "slot", storageKey: "upload-key" },
          tx,
        }),
      );
      if (storageKey === "upload-key") {
        await removal;
        expect(
          await runtime.db.select().from(documentAttachmentBlobProjection),
        ).toMatchObject([
          {
            blobId: "committed-blob",
            storageKey,
            detachedAt: expect.any(String),
          },
        ]);
        expect(
          await runtime.db.select().from(documentPendingAttachments),
        ).toEqual([]);
      } else {
        await expect(removal).rejects.toThrow(
          "Attachment slot changed during removal",
        );
        expect(
          await runtime.db.select().from(documentAttachmentBlobProjection),
        ).toMatchObject([{ blobId: null, storageKey, detachedAt: null }]);
        expect(
          await runtime.db.select().from(documentPendingAttachments),
        ).toHaveLength(1);
        expect(
          await execSql(
            "SELECT storage_key FROM document_orphan_blob_reclaims",
          ),
        ).toEqual([]);
      }
    } finally {
      close();
    }
  });
}
