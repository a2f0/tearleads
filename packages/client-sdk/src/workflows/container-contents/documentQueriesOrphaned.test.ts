import { expect, test } from "bun:test";
import { createTestExecSql } from "@symcrypt/test-utils";
import { sqlDocumentsPersistence } from "../../data/persistence/documents/documentsPersistence";
import { defaultContainerContentsPersistence } from "./containerPersistence";
import { createContainerDocumentQueriesFromRuntime } from "./documentQueries";
import { saveTestDocument } from "./documentQueries.testFixtures";

test("orphan recovery lists active-organization and unattributed last-link documents", async () => {
  const { close, execSql } = await createTestExecSql(
    "containerContents-orphan-recovery-window",
  );
  try {
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const readModel = createContainerDocumentQueriesFromRuntime({
      infra: { execSql },
    });

    for (const document of [
      {
        documentId: "remote-active-orphan",
        id: "active-orphan",
        title: "Active orphan",
      },
      {
        documentId: "remote-foreign-orphan",
        id: "foreign-orphan",
        title: "Foreign orphan",
      },
      {
        documentId: "remote-linked-document",
        id: "linked-document",
        title: "Linked document",
      },
      {
        documentId: "remote-unattributed-orphan",
        id: "unattributed-orphan",
        title: "Unattributed orphan",
      },
      {
        documentId: "remote-contained-document",
        id: "contained-document",
        title: "Contained document",
      },
    ]) {
      await saveTestDocument({
        containerId: "source-container",
        execSql,
        updatedAt: "2026-07-30T00:00:00.000Z",
        ...document,
      });
    }

    await execSql(
      `UPDATE document_projection
       SET container_id = NULL,
           organization_id = CASE local_id
             WHEN 'foreign-orphan' THEN 'org-2'
             ELSE 'org-1'
           END
       WHERE local_id IN (
         'active-orphan',
         'foreign-orphan',
         'linked-document',
         'unattributed-orphan'
       )`,
    );
    await execSql(
      `UPDATE document_projection
       SET organization_id = NULL
       WHERE local_id = 'unattributed-orphan'`,
    );
    await readModel.replaceDocumentLinksBatch([
      {
        containerIds: ["surviving-container"],
        documentId: "remote-linked-document",
      },
    ]);

    await expect(
      readModel.listContainerItemWindow({
        containerId: null,
        currentOrganizationId: "org-1",
        limit: 10,
        offset: 0,
        sort: { direction: "asc", key: "name" },
      }),
    ).resolves.toMatchObject({
      rows: [
        {
          containerId: null,
          itemKind: "document",
          localId: "active-orphan",
          name: "Active orphan",
        },
        {
          containerId: null,
          localId: "unattributed-orphan",
          name: "Unattributed orphan",
        },
      ],
      totalCount: 2,
    });

    await expect(
      readModel.listContainerDocumentSidebarWindow({
        containerId: null,
        currentOrganizationId: "org-1",
        limit: 10,
        offset: 0,
      }),
    ).resolves.toMatchObject({
      rows: [
        {
          containerId: null,
          localId: "active-orphan",
          title: "Active orphan",
        },
        {
          containerId: null,
          localId: "unattributed-orphan",
          title: "Unattributed orphan",
        },
      ],
      totalCount: 2,
    });

    await expect(
      readModel.listContainerItemWindow({
        containerId: null,
        currentOrganizationId: "org-2",
        limit: 10,
        offset: 0,
        sort: { direction: "asc", key: "name" },
      }),
    ).resolves.toMatchObject({
      rows: [{ localId: "foreign-orphan" }, { localId: "unattributed-orphan" }],
      totalCount: 2,
    });

    await expect(
      readModel.hasOrphanedDocuments({ currentOrganizationId: "org-1" }),
    ).resolves.toBe(true);
    await expect(
      readModel.hasOrphanedDocuments({ currentOrganizationId: "org-3" }),
    ).resolves.toBe(true);
    await expect(
      readModel.loadOrphanedDocumentSummary({
        currentOrganizationId: "org-1",
        localId: "active-orphan",
      }),
    ).resolves.toMatchObject({
      containerId: null,
      id: "active-orphan",
    });
    await expect(
      readModel.loadOrphanedDocumentSummary({
        currentOrganizationId: "org-1",
        localId: "foreign-orphan",
      }),
    ).resolves.toBeNull();
    await expect(
      readModel.loadOrphanedDocumentSummary({
        currentOrganizationId: "org-1",
        localId: "linked-document",
      }),
    ).resolves.toBeNull();

    await execSql(
      `UPDATE document_projection
       SET organization_id = 'org-1'
       WHERE local_id = 'unattributed-orphan'`,
    );
    await expect(
      readModel.hasOrphanedDocuments({ currentOrganizationId: "org-3" }),
    ).resolves.toBe(false);
  } finally {
    close();
  }
});
