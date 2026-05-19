import { expect, test } from "bun:test";
import {
  ensureDocumentTables,
  loadDocumentRecord,
  saveDocumentRecord,
} from "@tearleads/client-sdk/data/sqlite/documentPersistence";
import { createTestExecSql } from "../../../test/helpers/createTestExecSql";

test("document records persist runtime columns", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-record-persistence-test",
  );

  try {
    await ensureDocumentTables(execSql);

    await saveDocumentRecord(
      execSql,
      {
        appKind: "documents",
        localId: "local-document-1",
      },
      {
        accessEpoch: 2,
        accessStateHash: "access-hash-1",
        documentId: "remote-document-1",
        id: "local-document-1",
        lastCommitLsn: "0/10",
        loroSnapshot: "snapshot-1",
        contentKeyBundle: JSON.stringify({
          contentKeyEpoch: 1,
          linkSetManifestHash: "document-manifest-hash-1",
        }),
        documentKekTargets: JSON.stringify([
          {
            containerId: "container-1",
            containerKeyEpoch: 1,
            containerManifestHash: "container-manifest-hash-1",
          },
        ]),
        documentManifestBundle: JSON.stringify({
          eventHash: "event-hash-1",
          manifestHash: "document-manifest-hash-1",
        }),
      },
      "2026-04-12T00:00:00.000Z",
    );

    await expect(
      loadDocumentRecord(execSql, {
        appKind: "documents",
        localId: "local-document-1",
      }),
    ).resolves.toEqual({
      accessEpoch: 2,
      accessStateHash: "access-hash-1",
      documentId: "remote-document-1",
      id: "local-document-1",
      lastCommitLsn: "0/10",
      loroSnapshot: "snapshot-1",
      contentKeyBundle: JSON.stringify({
        contentKeyEpoch: 1,
        linkSetManifestHash: "document-manifest-hash-1",
      }),
      documentKekTargets: JSON.stringify([
        {
          containerId: "container-1",
          containerKeyEpoch: 1,
          containerManifestHash: "container-manifest-hash-1",
        },
      ]),
      documentManifestBundle: JSON.stringify({
        eventHash: "event-hash-1",
        manifestHash: "document-manifest-hash-1",
      }),
    });
  } finally {
    close();
  }
});
