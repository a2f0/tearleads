import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { sqlDocumentContainerProjectionPersistence } from "./documentContainerProjectionPersistence";

test("listLinkedContainerIdsByDocumentIds returns empty arrays for documents with no links", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-container-projection-test",
  );

  try {
    await sqlDocumentContainerProjectionPersistence.replaceDocumentLinksBatch(
      execSql,
      [
        {
          containerIds: ["container-a", "container-b"],
          documentId: "document-with-links",
        },
      ],
    );

    await expect(
      sqlDocumentContainerProjectionPersistence.listLinkedContainerIdsByDocumentIds(
        execSql,
        ["document-with-links", "document-without-links"],
      ),
    ).resolves.toEqual(
      new Map([
        ["document-with-links", ["container-a", "container-b"]],
        ["document-without-links", []],
      ]),
    );
  } finally {
    close();
  }
});

test("listDocumentIdsByContainerIds returns unique document ids linked to containers", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-container-projection-test",
  );

  try {
    await sqlDocumentContainerProjectionPersistence.replaceDocumentLinksBatch(
      execSql,
      [
        {
          containerIds: ["container-a", "container-b"],
          documentId: "document-1",
        },
        {
          containerIds: ["container-b"],
          documentId: "document-2",
        },
        {
          containerIds: ["container-c"],
          documentId: "document-3",
        },
      ],
    );

    await expect(
      sqlDocumentContainerProjectionPersistence.listDocumentIdsByContainerIds(
        execSql,
        ["container-a", "container-b"],
      ),
    ).resolves.toEqual(["document-1", "document-2"]);
  } finally {
    close();
  }
});

test("replaceDocumentLinksBatch keeps the latest links for duplicate document ids", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-container-projection-test",
  );

  try {
    await sqlDocumentContainerProjectionPersistence.replaceDocumentLinksBatch(
      execSql,
      [
        {
          containerIds: ["container-a"],
          documentId: "document-1",
        },
        {
          containerIds: ["container-b", "container-c"],
          documentId: "document-1",
        },
      ],
    );

    await expect(
      sqlDocumentContainerProjectionPersistence.listLinkedContainerIds(
        execSql,
        "document-1",
      ),
    ).resolves.toEqual(["container-b", "container-c"]);
  } finally {
    close();
  }
});
