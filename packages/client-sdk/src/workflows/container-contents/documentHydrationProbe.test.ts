import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { sqlDocumentsPersistence } from "../../data/persistence/documents/documentsPersistence";
import { defaultContainerContentsPersistence } from "./containerPersistence";
import { probeUndiscoveredRemoteDocuments } from "./documentHydrationProbe";
import type { ContainerDocumentPrimeHost } from "./documentQueries/types";
import {
  saveTestContainer,
  saveTestDocument,
} from "./documentQueries.testFixtures";
import { requestDocumentRuntimeTargetSync } from "./documentRuntimeTargetSync";

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

test("hydration probe opens only unlisted remote documents in the active organization", async () => {
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
    }
    await execSql(
      "UPDATE document_projection SET container_id = NULL, organization_id = ? WHERE local_id = ?",
      ["org-a", "orphan-local"],
    );
    await execSql(
      "UPDATE document_projection SET document_kind = 'organization_profile' WHERE local_id = ?",
      ["hidden-local"],
    );

    const opened: Array<{ containerId: string | null; localId: string }> = [];
    const probeCount = await probeUndiscoveredRemoteDocuments({
      host: createProbeHost(opened),
      listedDocumentIds: new Set(["listed-remote"]),
      organizationId: "org-a",
      runtime: { infra: { execSql } },
    });

    expect(probeCount).toBe(2);
    expect(opened).toEqual([
      { containerId: "root-a", localId: "missing-local" },
      { containerId: null, localId: "orphan-local" },
    ]);
  } finally {
    close();
  }
});

test("document runtime target sync yields between eight-store chunks", async () => {
  const openedAfterYield: boolean[] = [];
  let yielded = false;
  setTimeout(() => {
    yielded = true;
  }, 0);

  await requestDocumentRuntimeTargetSync({
    host: {
      documentWorkflowRuntime: (containerId) => containerId,
      openDocumentStore: () => {
        openedAfterYield.push(yielded);
        return { requestSync: () => undefined };
      },
    },
    targets: Array.from({ length: 9 }, (_, index) => ({
      documentId: `document-${index}`,
      localId: `local-${index}`,
      runtimeContainerId: "root",
    })),
  });

  expect(openedAfterYield.slice(0, 8)).toEqual(Array(8).fill(false));
  expect(openedAfterYield[8]).toBe(true);
});
