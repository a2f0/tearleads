import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  applyContainerDocumentTombstones,
  sqlDocumentsPersistence,
} from "../../data/persistence/documents/documentsPersistence";
import { defaultContainerContentsPersistence } from "./containerPersistence";
import { createContainerDocumentQueriesFromRuntime } from "./documentQueries";
import {
  saveTestContainer,
  saveTestDocument,
} from "./documentQueries.testFixtures";

test("listContainerItemWindow drops every duplicate projection when a document is unlinked from a container", async () => {
  // Identity recovery can rematerialize a second local projection row for the
  // same server document before convergence completes. When a peer then moves
  // that document out of a container (a source-container unlink tombstone), the
  // container it left must no longer surface it through ANY projection row.
  const { close, execSql } = await createTestExecSql(
    "containerContents-tombstone-duplicate-projection",
  );
  try {
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const runtime = { infra: { execSql } };
    const readModel = createContainerDocumentQueriesFromRuntime(runtime);

    await saveTestContainer({
      execSql,
      id: "root",
      name: "Root",
      parentId: null,
      timestamp: "2026-05-01T00:00:00.000Z",
    });

    // Two local rows for the same server document, both primary=root.
    await saveTestDocument({
      execSql,
      id: "recovered-local",
      documentId: "contact-1",
      containerId: "root",
      title: "Ada Lovelace",
      updatedAt: "2026-05-02T00:00:00.000Z",
    });
    await saveTestDocument({
      execSql,
      id: "rematerialized-local",
      documentId: "contact-1",
      containerId: "root",
      title: "Ada Lovelace",
      updatedAt: "2026-05-02T00:00:00.000Z",
    });
    await readModel.replaceDocumentLinksBatch([
      { documentId: "contact-1", containerIds: ["root"] },
    ]);
    await applyContainerDocumentTombstones(execSql, [
      {
        containerId: "root",
        documentId: "contact-1",
        accessEpoch: 1,
        linkedContainerIds: [],
        updatedAt: "2026-05-03T00:00:00.000Z",
      },
    ]);

    const rootWindow = await readModel.listContainerItemWindow({
      containerId: "root",
      limit: 10,
      offset: 0,
      sort: { direction: "asc", key: "name" },
    });
    expect(
      rootWindow.rows.filter((row) => row.itemKind === "document"),
    ).toEqual([]);
    expect(rootWindow.totalCount).toBe(0);
  } finally {
    close();
  }
});
