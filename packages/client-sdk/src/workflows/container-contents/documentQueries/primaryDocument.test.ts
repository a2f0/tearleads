import { expect, test } from "bun:test";
import { emptyVersionVector } from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import { sqlDocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
import { defaultContainerContentsPersistence } from "../containerPersistence";
import { createContainerDocumentQueriesFromRuntime } from "./index";

test.each(["folder", null])(
  "note windows filter before counting and paging in %s",
  async (containerId) => {
    const { execSql, close } = await createTestExecSql("container-note-window");
    try {
      await defaultContainerContentsPersistence.ensureSchema(execSql);
      await sqlDocumentsPersistence.ensureSchema(execSql);
      const queries = createContainerDocumentQueriesFromRuntime({
        infra: { execSql },
      });
      for (const [id, kind] of [
        ["a", "contact"],
        ["b", "note"],
        ["c", "note"],
      ] as const) {
        await sqlDocumentsPersistence.saveDocument(execSql, {
          id,
          documentId: id,
          containerId,
          documentKind: kind,
          title: id,
          text: "",
          accessEpoch: 1,
          snapshotEndVersion: emptyVersionVector(),
        });
      }
      const result = await queries.listContainerDocumentSidebarWindow({
        containerId,
        documentKind: "note",
        limit: 1,
        offset: 1,
      });
      expect(result.totalCount).toBe(2);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.documentKind).toBe("note");
    } finally {
      close();
    }
  },
);

test("primary lookup uses canonical identity and direct or secondary membership, not the visible page", async () => {
  const { execSql, close } = await createTestExecSql("container-primary-query");
  try {
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const queries = createContainerDocumentQueriesFromRuntime({
      infra: { execSql },
    });
    await sqlDocumentsPersistence.saveDocument(execSql, {
      id: "device-local-contact",
      documentId: "canonical-contact",
      containerId: "direct",
      documentKind: "contact",
      title: "Z Person",
      text: "",
      accessEpoch: 1,
      snapshotEndVersion: emptyVersionVector(),
      effectiveAccessLevel: "read",
    });
    await queries.replaceDocumentLinksBatch([
      {
        documentId: "canonical-contact",
        containerIds: ["direct", "secondary"],
      },
    ]);
    await sqlDocumentsPersistence.saveDocument(execSql, {
      id: "first-page-local",
      documentId: "first-page-canonical",
      containerId: "direct",
      documentKind: "note",
      title: "A first page",
      text: "",
      accessEpoch: 1,
      snapshotEndVersion: emptyVersionVector(),
    });
    const visible = await queries.listContainerDocumentSidebarWindow({
      containerId: "direct",
      offset: 0,
      limit: 1,
    });
    expect(visible.rows).toHaveLength(1);
    expect(visible.rows[0]?.localId).toBe("first-page-local");
    for (const containerId of ["direct", "secondary"]) {
      expect(
        await queries.loadContainerDocumentSummary({
          containerId,
          documentId: "canonical-contact",
        }),
      ).toMatchObject({
        id: "device-local-contact",
        documentId: "canonical-contact",
        containerId,
        documentKind: "contact",
        effectiveAccessLevel: "read",
      });
    }
    expect(
      await queries.loadContainerDocumentSummary({
        containerId: "other",
        documentId: "canonical-contact",
      }),
    ).toBeNull();
    expect(
      await queries.loadContainerDocumentSummary({
        containerId: "direct",
        documentId: "device-local-contact",
      }),
    ).toBeNull();
  } finally {
    close();
  }
});
