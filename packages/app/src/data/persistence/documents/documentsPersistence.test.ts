import { expect, test } from "bun:test";
import { createTestExecSql } from "../../../../test/helpers/createTestExecSql";
import { sqlDocumentContainerProjectionPersistence } from "../containers/documentContainerProjectionPersistence";
import {
  applyContainerDocumentTombstones,
  sqlDocumentsPersistence,
} from "./documentsPersistence";

test("container document tombstones remove links and repair selected container", async () => {
  const { close, execSql } = await createTestExecSql(
    "documents-persistence-test",
  );

  try {
    await sqlDocumentContainerProjectionPersistence.replaceDocumentLinksBatch(
      execSql,
      [
        {
          containerIds: ["container-a", "container-b"],
          documentId: "document-1",
        },
      ],
    );
    await sqlDocumentsPersistence.upsertDiscoveredDocument(execSql, {
      accessEpoch: 1,
      accessStateHash: "access-state-hash-1",
      containerId: "container-a",
      createdAt: "2026-05-05T00:00:00.000Z",
      documentId: "document-1",
      linkedContainerIds: ["container-a", "container-b"],
    });

    await expect(
      applyContainerDocumentTombstones(execSql, [
        {
          containerId: "container-a",
          documentId: "document-1",
          updatedAt: "2026-05-05T00:05:00.000Z",
        },
      ]),
    ).resolves.toEqual([
      {
        accessStateHash: "access-state-hash-1",
        containerId: "container-b",
        documentId: "document-1",
        documentKind: "note",
        id: "document-1",
        title: "Untitled note",
        updatedAt: "2026-05-05T00:05:00.000Z",
      },
    ]);
    await expect(
      sqlDocumentContainerProjectionPersistence.listLinkedContainerIds(
        execSql,
        "document-1",
      ),
    ).resolves.toEqual(["container-b"]);
    await expect(
      sqlDocumentsPersistence.loadDocument(execSql, "document-1"),
    ).resolves.toMatchObject({
      containerId: "container-b",
      documentId: "document-1",
    });

    await expect(
      applyContainerDocumentTombstones(execSql, [
        {
          containerId: "container-b",
          documentId: "document-1",
          updatedAt: "2026-05-05T00:10:00.000Z",
        },
      ]),
    ).resolves.toEqual([
      {
        accessStateHash: "access-state-hash-1",
        containerId: null,
        documentId: "document-1",
        documentKind: "note",
        id: "document-1",
        title: "Untitled note",
        updatedAt: "2026-05-05T00:10:00.000Z",
      },
    ]);
    await expect(
      sqlDocumentContainerProjectionPersistence.listLinkedContainerIds(
        execSql,
        "document-1",
      ),
    ).resolves.toEqual([]);
    await expect(
      sqlDocumentsPersistence.loadDocument(execSql, "document-1"),
    ).resolves.toMatchObject({
      containerId: null,
      documentId: "document-1",
    });
  } finally {
    close();
  }
});
