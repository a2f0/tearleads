import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { sqlDocumentsPersistence } from "../../data/persistence/documents/documentsPersistence";
import { defaultContainerContentsPersistence } from "./containerPersistence";
import { primeDocumentsForLoadedRoots } from "./documentPriming";
import { saveTestDocument } from "./documentQueries.testFixtures";

function createPrimeHost(
  opened: Array<{ containerId: string; localId: string }>,
) {
  return {
    documentWorkflowRuntime: (containerId: string) => ({ containerId }),
    openDocumentStore: (input: {
      localId: string;
      runtime: { containerId: string };
    }) => {
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

test("priming leaves an absent-container orphan for root recovery", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-priming-missing-container-fallback",
  );
  try {
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await saveTestDocument({
      containerId: "deleted-local-root",
      documentId: null,
      execSql,
      id: "orphaned-document",
      title: "Private title must not be telemetry",
      updatedAt: "2026-07-23T14:19:12.658Z",
    });
    const opened: Array<{ containerId: string; localId: string }> = [];

    const result = await primeDocumentsForLoadedRoots({
      containersById: new Map(),
      host: createPrimeHost(opened),
      runtime: { infra: { execSql } },
    });

    expect(result).toEqual({
      candidateCount: 1,
      primedCount: 0,
      rootCount: 0,
      unroutableCount: 1,
    });
    expect(opened).toEqual([]);
  } finally {
    close();
  }
});

test("priming does not wake hidden organization profile documents", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-priming-hidden-kind-fallback",
  );
  try {
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await saveTestDocument({
      containerId: "root",
      documentId: null,
      execSql,
      id: "organization-profile",
      title: "Private organization name",
      updatedAt: "2026-07-23T14:19:12.658Z",
    });
    await execSql(
      "UPDATE document_projection SET document_kind = 'organization_profile' WHERE local_id = ?",
      ["organization-profile"],
    );
    const opened: Array<{ containerId: string; localId: string }> = [];

    const result = await primeDocumentsForLoadedRoots({
      containersById: new Map([
        ["root", { container: { id: "root", parentId: null } }],
      ]),
      host: createPrimeHost(opened),
      runtime: { infra: { execSql } },
    });

    expect(result.primedCount).toBe(0);
    expect(result.unroutableCount).toBe(1);
    expect(opened).toEqual([]);
  } finally {
    close();
  }
});

test("priming retains candidates with no safe runtime container", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-priming-unroutable",
  );
  try {
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await saveTestDocument({
      containerId: "root",
      documentId: null,
      execSql,
      id: "unroutable-document",
      title: "Private title",
      updatedAt: "2026-07-23T14:19:12.658Z",
    });
    await execSql(
      "UPDATE document_projection SET container_id = NULL WHERE local_id = ?",
      ["unroutable-document"],
    );
    const opened: Array<{ containerId: string; localId: string }> = [];

    const result = await primeDocumentsForLoadedRoots({
      containersById: new Map(),
      host: createPrimeHost(opened),
      runtime: { infra: { execSql } },
    });

    expect(result.unroutableCount).toBe(1);
    expect(result.primedCount).toBe(0);
    expect(opened).toEqual([]);
  } finally {
    close();
  }
});

test("priming traverses a loaded root subtree", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-priming-direct-share",
  );
  try {
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await saveTestDocument({
      containerId: "shared-child",
      documentId: null,
      execSql,
      id: "shared-document",
      title: "Private shared title",
      updatedAt: "2026-07-23T14:19:12.658Z",
    });
    const opened: Array<{ containerId: string; localId: string }> = [];

    const result = await primeDocumentsForLoadedRoots({
      containersById: new Map([
        ["root", { container: { id: "root", parentId: null } }],
        [
          "shared-child",
          { container: { id: "shared-child", parentId: "root" } },
        ],
      ]),
      host: createPrimeHost(opened),
      runtime: { infra: { execSql } },
    });

    expect(result.primedCount).toBe(1);
    expect(result.unroutableCount).toBe(0);
    expect(opened).toEqual([
      { containerId: "shared-child", localId: "shared-document" },
    ]);
  } finally {
    close();
  }
});
