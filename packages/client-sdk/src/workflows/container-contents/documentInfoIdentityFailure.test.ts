import { expect, test } from "bun:test";
import { KeyingVerificationError } from "@symcrypt/crypto";
import { createTestExecSql } from "@symcrypt/test-utils";
import type { DocumentWriterProjectionResponse } from "@symcrypt/validators/response";
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
  const reports: Array<{ error: unknown; operation: string }> = [];

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
        reportSecurityIncident: async (error, context) => {
          reports.push({ error, operation: context.operation });
        },
      }),
    ).rejects.toBe(integrityError);
    expect(reports).toEqual([
      {
        error: integrityError,
        operation: "document.info.attribution",
      },
    ]);
  } finally {
    close();
  }
});
