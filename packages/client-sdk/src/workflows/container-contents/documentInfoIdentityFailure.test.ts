import { expect, test } from "bun:test";
import { KeyingVerificationError } from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import { sqlDocumentsPersistence } from "../../data/persistence/documents/documentsPersistence";
import { loadDocumentInfo } from "./documentInfo";

test("document info propagates attribution identity failures instead of returning null", async () => {
  const { close, execSql } = await createTestExecSql(
    "containerContents-document-info-identity-failure",
  );
  const integrityError = new KeyingVerificationError(
    "equivocation",
    "trusted attribution identity changed",
  );

  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await sqlDocumentsPersistence.saveDocument(execSql, {
      accessEpoch: 1,
      accessStateHash: "access-state",
      containerId: "container",
      documentId: "document",
      documentKind: "note",
      id: "local-document",
      lastCommitLsn: null,
      snapshotEndVersion: "",
      text: "",
      title: "Document",
    });

    await expect(
      loadDocumentInfo({
        apiClient: {
          getDocumentEditAttribution: async () => {
            throw integrityError;
          },
          getDocumentWriterProjection: async () =>
            ({ documentId: "document" }) as DocumentWriterProjectionResponse,
          listDocumentAttachments: async () => [],
        },
        execSql,
        localId: "local-document",
      }),
    ).rejects.toBe(integrityError);
  } finally {
    close();
  }
});
