import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { sqlDocumentsPersistence } from "../../data/persistence/documents/documentsPersistence";
import { defaultContainerContentsPersistence } from "./containerPersistence";
import { probeUndiscoveredRemoteDocumentBatch } from "./documentHydrationProbe";
import type { ContainerDocumentPrimeHost } from "./documentQueries/types";
import {
  saveTestContainer,
  saveTestDocument,
} from "./documentQueries.testFixtures";

function createProbeHost(
  opened: Array<{ containerId: string | null; localId: string }>,
): ContainerDocumentPrimeHost<{ containerId: string | null }> {
  return {
    documentWorkflowRuntime: (containerId) => ({ containerId }),
    openDocumentStore: (input) => {
      opened.push({
        containerId: input.runtime.containerId,
        localId: input.localId,
      });
      return {
        getSnapshot: () => ({ ready: true }),
        requestSync: () => undefined,
      };
    },
  };
}

test("hydration probe scopes unlisted documents to completed container lanes", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-hydration-probe",
  );
  try {
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await saveTestContainer({
      execSql,
      id: "root-a",
      name: "Root A",
      organizationId: "org-a",
      parentId: null,
      timestamp: "2026-07-30T12:00:00.000Z",
    });
    await saveTestContainer({
      execSql,
      id: "root-b",
      name: "Root B",
      organizationId: "org-b",
      parentId: null,
      timestamp: "2026-07-30T12:00:00.000Z",
    });

    const documents = [
      ["listed-local", "listed-remote", "root-a"],
      ["missing-local", "missing-remote", "root-a"],
      ["foreign-local", "foreign-remote", "root-b"],
      ["local-only", null, "root-a"],
      ["orphan-local", "orphan-remote", "root-a"],
      ["hidden-local", "hidden-remote", "root-a"],
    ] as const;
    for (const [id, documentId, containerId] of documents) {
      await saveTestDocument({
        containerId,
        documentId,
        execSql,
        id,
        title: id,
        updatedAt: "2026-07-30T12:00:00.000Z",
      });
      if (documentId) {
        await execSql(
          `INSERT INTO document_container_projection
             (document_id, container_id, updated_at)
           VALUES (?, ?, ?)`,
          [documentId, containerId, "2026-07-30T12:00:00.000Z"],
        );
      }
    }
    await execSql(
      "UPDATE document_projection SET container_id = NULL, organization_id = ? WHERE local_id = ?",
      ["org-a", "orphan-local"],
    );
    await execSql(
      "DELETE FROM document_container_projection WHERE document_id = ?",
      ["orphan-remote"],
    );
    await execSql(
      "UPDATE document_projection SET document_kind = 'organization_profile' WHERE local_id = ?",
      ["hidden-local"],
    );

    const opened: Array<{ containerId: string | null; localId: string }> = [];
    const result = await probeUndiscoveredRemoteDocumentBatch({
      afterLocalId: null,
      host: createProbeHost(opened),
      listedContainerIds: new Set(["root-a"]),
      listedDocumentIds: new Set(["listed-remote"]),
      organizationId: "org-a",
      runtime: { infra: { execSql } },
    });

    expect(result).toEqual({
      done: true,
      nextCursor: null,
      requestedCount: 1,
    });
    expect(opened).toEqual([
      { containerId: "root-a", localId: "missing-local" },
    ]);
  } finally {
    close();
  }
});

test("hydration probe advances through bounded candidate batches", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-hydration-probe-batches",
  );
  try {
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await saveTestContainer({
      execSql,
      id: "root-a",
      name: "Root A",
      organizationId: "org-a",
      parentId: null,
      timestamp: "2026-07-30T12:00:00.000Z",
    });
    for (let index = 0; index < 9; index += 1) {
      await saveTestDocument({
        containerId: "root-a",
        documentId: `remote-${index}`,
        execSql,
        id: `local-${index}`,
        title: `Document ${index}`,
        updatedAt: "2026-07-30T12:00:00.000Z",
      });
      await execSql(
        `INSERT INTO document_container_projection
           (document_id, container_id, updated_at)
         VALUES (?, ?, ?)`,
        [`remote-${index}`, "root-a", "2026-07-30T12:00:00.000Z"],
      );
    }

    const opened: Array<{ containerId: string | null; localId: string }> = [];
    const first = await probeUndiscoveredRemoteDocumentBatch({
      afterLocalId: null,
      host: createProbeHost(opened),
      listedContainerIds: new Set(["root-a"]),
      listedDocumentIds: new Set(),
      organizationId: "org-a",
      runtime: { infra: { execSql } },
    });
    const second = await probeUndiscoveredRemoteDocumentBatch({
      afterLocalId: first.nextCursor,
      host: createProbeHost(opened),
      listedContainerIds: new Set(["root-a"]),
      listedDocumentIds: new Set(),
      organizationId: "org-a",
      runtime: { infra: { execSql } },
    });

    expect(first.done).toBe(false);
    expect(first.requestedCount).toBe(8);
    expect(second).toEqual({
      done: true,
      nextCursor: null,
      requestedCount: 1,
    });
    expect(opened).toHaveLength(9);
  } finally {
    close();
  }
});
