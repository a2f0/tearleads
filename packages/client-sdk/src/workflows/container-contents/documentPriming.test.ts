import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { sqlDocumentsPersistence } from "../../data/persistence/documents/documentsPersistence";
import { defaultContainerContentsPersistence } from "./containerPersistence";
import { primeDocumentsForLoadedRoots } from "./documentPriming";
import {
  insertTestPendingUpdate,
  saveTestDocument,
} from "./documentQueries.testFixtures";

function createPrimeHost(
  opened: Array<{ containerId: string | null; localId: string }>,
) {
  return {
    documentWorkflowRuntime: (containerId: string | null) => ({ containerId }),
    openDocumentStore: (input: {
      localId: string;
      runtime: { containerId: string | null };
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
    const opened: Array<{ containerId: string | null; localId: string }> = [];

    const result = await primeDocumentsForLoadedRoots({
      containersById: new Map(),
      host: createPrimeHost(opened),
      organizationId: "org-a",
      runtime: { infra: { execSql } },
    });

    expect(result).toEqual({
      candidateCount: 1,
      orphanPrimedCount: 0,
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
    const opened: Array<{ containerId: string | null; localId: string }> = [];

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

test("a local-only orphan primes for its terminal create attempt", async () => {
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
    // The row-3 cascade orphaned a local-only create: it now primes with a
    // null container scope so its pass can record a terminal failure row
    // instead of sitting invisible forever.
    await execSql(
      "UPDATE document_projection SET container_id = NULL, organization_id = 'org-a' WHERE local_id = ?",
      ["unroutable-document"],
    );
    const opened: Array<{ containerId: string | null; localId: string }> = [];

    const result = await primeDocumentsForLoadedRoots({
      containersById: new Map(),
      host: createPrimeHost(opened),
      organizationId: "org-a",
      runtime: { infra: { execSql } },
    });

    expect(result.unroutableCount).toBe(0);
    expect(result.orphanPrimedCount).toBe(1);
    expect(opened).toEqual([
      { containerId: null, localId: "unroutable-document" },
    ]);
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
    const opened: Array<{ containerId: string | null; localId: string }> = [];

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

test("loaded-root priming abandons the next chunk after its generation changes", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-priming-generation-chunk",
  );
  try {
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const expectedLocalIds: string[] = [];
    for (let index = 0; index < 10; index += 1) {
      const localId = `generation-${String(index).padStart(2, "0")}`;
      expectedLocalIds.push(localId);
      await saveTestDocument({
        containerId: "root",
        documentId: null,
        execSql,
        id: localId,
        title: `Generation ${index}`,
        updatedAt: `2026-08-31T00:00:${String(index).padStart(2, "0")}.000Z`,
      });
    }
    let current = true;
    const opened: string[] = [];

    const result = await primeDocumentsForLoadedRoots({
      containersById: new Map([
        ["root", { container: { id: "root", parentId: null } }],
      ]),
      host: {
        documentWorkflowRuntime: () => null,
        openDocumentStore: ({ localId }) => {
          opened.push(localId);
          return {
            getSnapshot: () => ({ ready: true }),
            requestSync: () => {
              if (opened.length === 8) {
                queueMicrotask(() => {
                  current = false;
                });
              }
            },
          };
        },
      },
      isCurrent: () => current,
      runtime: { infra: { execSql } },
    });

    expect(opened.toSorted()).toEqual(expectedLocalIds.slice(2));
    expect(result.primedCount).toBe(8);
    expect(result.unroutableCount).toBe(2);
  } finally {
    close();
  }
});

test("a last-link orphan primes with a null container scope", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-priming-null-container-orphan",
  );
  try {
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await saveTestDocument({
      containerId: "revoked-container",
      documentId: "remote-orphan",
      execSql,
      id: "orphaned-document",
      title: "Orphan with queued edits",
      updatedAt: "2026-07-23T14:19:12.658Z",
    });
    // The row-3 cascade shape: last link gone, projection container nulled,
    // organization attribution preserved.
    await execSql(
      "UPDATE document_projection SET container_id = NULL, organization_id = 'org-a' WHERE local_id = ?",
      ["orphaned-document"],
    );
    await insertTestPendingUpdate({
      appKind: "documents",
      createdAt: "2026-07-23T14:19:13.000Z",
      execSql,
      id: "orphan-edit",
      localId: "orphaned-document",
    });
    const opened: Array<{ containerId: string | null; localId: string }> = [];

    const result = await primeDocumentsForLoadedRoots({
      containersById: new Map(),
      host: createPrimeHost(opened),
      organizationId: "org-a",
      runtime: { infra: { execSql } },
    });

    expect(result).toEqual({
      candidateCount: 1,
      orphanPrimedCount: 1,
      primedCount: 1,
      rootCount: 0,
      unroutableCount: 0,
    });
    expect(opened).toEqual([
      { containerId: null, localId: "orphaned-document" },
    ]);

    // Another organization's store never picks this orphan up.
    const foreignOpened: Array<{
      containerId: string | null;
      localId: string;
    }> = [];
    const foreignResult = await primeDocumentsForLoadedRoots({
      containersById: new Map(),
      host: createPrimeHost(foreignOpened),
      organizationId: "org-b",
      runtime: { infra: { execSql } },
    });
    expect(foreignResult.orphanPrimedCount).toBe(0);
    expect(foreignOpened).toEqual([]);
  } finally {
    close();
  }
});

test("a hidden-kind orphan stays unprimed", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-priming-hidden-orphan",
  );
  try {
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await saveTestDocument({
      containerId: "revoked-container",
      documentId: null,
      execSql,
      id: "hidden-orphan",
      title: "Private organization name",
      updatedAt: "2026-07-23T14:19:12.658Z",
    });
    await execSql(
      "UPDATE document_projection SET container_id = NULL, document_kind = 'organization_profile', organization_id = 'org-a' WHERE local_id = ?",
      ["hidden-orphan"],
    );
    const opened: Array<{ containerId: string | null; localId: string }> = [];

    const result = await primeDocumentsForLoadedRoots({
      containersById: new Map(),
      host: createPrimeHost(opened),
      organizationId: "org-a",
      runtime: { infra: { execSql } },
    });

    expect(result.orphanPrimedCount).toBe(0);
    expect(opened).toEqual([]);
  } finally {
    close();
  }
});

test("a pre-auth orphan with no organization still primes", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-priming-preauth-orphan",
  );
  try {
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await saveTestDocument({
      containerId: "deleted-preauth-container",
      documentId: null,
      execSql,
      id: "preauth-orphan",
      title: "Device-first note",
      updatedAt: "2026-07-23T14:19:12.658Z",
    });
    // Created before authentication: no organization attribution exists.
    await execSql(
      "UPDATE document_projection SET container_id = NULL, organization_id = '' WHERE local_id = ?",
      ["preauth-orphan"],
    );
    const opened: Array<{ containerId: string | null; localId: string }> = [];

    const result = await primeDocumentsForLoadedRoots({
      containersById: new Map(),
      host: createPrimeHost(opened),
      organizationId: "org-a",
      runtime: { infra: { execSql } },
    });

    expect(result.orphanPrimedCount).toBe(1);
    expect(opened).toEqual([{ containerId: null, localId: "preauth-orphan" }]);
  } finally {
    close();
  }
});
