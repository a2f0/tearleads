import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import { waitFor } from "../../../test/helpers/waitFor";
import { createMemoryBlobStore } from "../../data/blobs/memoryBlobStore";
import { defaultDocumentProjectorRegistry } from "../../data/documents/documentKinds";
import { createDomainScope } from "../../data/domainScope";
import { sqlDocumentsPersistence } from "../../data/persistence/documents/documentsPersistence";
import { openDocumentStore } from "../../stores/documents";
import { createDocumentsWorkflowRuntime } from "../documents";
import { defaultContainerContentsPersistence } from "./containerPersistence";
import { probeUndiscoveredRemoteDocumentBatch } from "./documentHydrationProbe";
import type { ContainerDocumentProbeHost } from "./documentQueries/types";
import {
  saveTestContainer,
  saveTestDocument,
} from "./documentQueries.testFixtures";

function createProbeHost(
  opened: Array<{ containerId: string | null; localId: string }>,
): ContainerDocumentProbeHost<{ containerId: string | null }> {
  return {
    documentWorkflowRuntime: (containerId) => ({ containerId }),
    openDocumentStore: (input) => {
      opened.push({
        containerId: input.runtime.containerId,
        localId: input.localId,
      });
      return {
        requestRemoteSync: () => undefined,
      };
    },
  };
}

test("hydration probe includes shared-org and primary-only documents", async () => {
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
      ["primary-only-local", "primary-only-remote", "root-a"],
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
      if (documentId && id !== "primary-only-local") {
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
    await execSql(
      `INSERT INTO document_container_projection
         (document_id, container_id, updated_at)
       VALUES (?, ?, ?)`,
      ["foreign-remote", "root-a", "2026-07-30T12:00:00.000Z"],
    );

    const opened: Array<{ containerId: string | null; localId: string }> = [];
    const result = await probeUndiscoveredRemoteDocumentBatch({
      afterLocalId: null,
      host: createProbeHost(opened),
      listedContainerIds: new Set(["root-a", "root-b"]),
      listedDocumentIds: new Set(["listed-remote"]),
      runtime: { infra: { execSql } },
    });

    expect(result).toEqual({
      done: true,
      nextCursor: null,
      requestedCount: 3,
    });
    expect(opened).toEqual([
      { containerId: "root-b", localId: "foreign-local" },
      { containerId: "root-a", localId: "missing-local" },
      { containerId: "root-a", localId: "primary-only-local" },
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
      runtime: { infra: { execSql } },
    });
    const second = await probeUndiscoveredRemoteDocumentBatch({
      afterLocalId: first.nextCursor,
      host: createProbeHost(opened),
      listedContainerIds: new Set(["root-a"]),
      listedDocumentIds: new Set(),
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

test("hydration probe scans past a healthy listed prefix in one turn", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-hydration-probe-listed-prefix",
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
    const listedDocumentIds = new Set<string>();
    for (let index = 0; index < 9; index += 1) {
      const documentId = `remote-${index}`;
      await saveTestDocument({
        containerId: "root-a",
        documentId,
        execSql,
        id: `local-${index}`,
        title: `Document ${index}`,
        updatedAt: "2026-07-30T12:00:00.000Z",
      });
      await execSql(
        `INSERT INTO document_container_projection
           (document_id, container_id, updated_at)
         VALUES (?, ?, ?)`,
        [documentId, "root-a", "2026-07-30T12:00:00.000Z"],
      );
      if (index < 8) {
        listedDocumentIds.add(documentId);
      }
    }

    const opened: Array<{ containerId: string | null; localId: string }> = [];
    const result = await probeUndiscoveredRemoteDocumentBatch({
      afterLocalId: null,
      host: createProbeHost(opened),
      listedContainerIds: new Set(["root-a"]),
      listedDocumentIds,
      runtime: { infra: { execSql } },
    });

    expect(result).toEqual({
      done: true,
      nextCursor: null,
      requestedCount: 1,
    });
    expect(opened).toEqual([{ containerId: "root-a", localId: "local-8" }]);
  } finally {
    close();
  }
});

test("hydration probe batches large container-id sets below SQLite limits", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-hydration-probe-container-batches",
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
    await saveTestDocument({
      containerId: "root-a",
      documentId: "missing-remote",
      execSql,
      id: "missing-local",
      title: "Missing",
      updatedAt: "2026-07-30T12:00:00.000Z",
    });
    await execSql(
      `INSERT INTO document_container_projection
         (document_id, container_id, updated_at)
       VALUES (?, ?, ?)`,
      ["missing-remote", "root-a", "2026-07-30T12:00:00.000Z"],
    );

    const probeParameterCounts: number[] = [];
    const boundedExecSql = new Proxy(execSql, {
      apply: (target, thisArg, args) => {
        const [sql, params] = args;
        if (typeof sql === "string" && sql.includes("FROM documents stored")) {
          probeParameterCounts.push(Array.isArray(params) ? params.length : 0);
        }
        return Reflect.apply(target, thisArg, args);
      },
    });
    const listedContainerIds = new Set([
      "root-a",
      ...Array.from({ length: 1_000 }, (_, index) => `missing-${index}`),
    ]);
    const opened: Array<{ containerId: string | null; localId: string }> = [];

    const result = await probeUndiscoveredRemoteDocumentBatch({
      afterLocalId: null,
      host: createProbeHost(opened),
      listedContainerIds,
      listedDocumentIds: new Set(),
      runtime: { infra: { execSql: boundedExecSql } },
    });

    expect(probeParameterCounts).toHaveLength(3);
    expect(Math.max(...probeParameterCounts)).toBeLessThanOrEqual(504);
    expect(result.requestedCount).toBe(1);
    expect(opened).toEqual([
      { containerId: "root-a", localId: "missing-local" },
    ]);
  } finally {
    close();
  }
});

test("an undiscovered probe uses coded deletion to destroy local state", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-hydration-probe-coded-deletion",
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
    await saveTestDocument({
      containerId: "root-a",
      documentId: "deleted-remote",
      execSql,
      id: "deleted-local",
      title: "Deleted remotely",
      updatedAt: "2026-07-30T12:00:00.000Z",
    });
    await execSql(
      `INSERT INTO document_container_projection
         (document_id, container_id, updated_at)
       VALUES (?, ?, ?)`,
      ["deleted-remote", "root-a", "2026-07-30T12:00:00.000Z"],
    );

    const signingKeyPair = generateSigningSeedAndKeyPair();
    const encapsulationKeyPair = generateKemSeedAndKeyPair();
    const signingFingerprint = await toFingerprint(
      signingKeyPair.signingPublicKey,
    );
    const runtime = createDocumentsWorkflowRuntime({
      apiClient: createMockApiClient({
        getDocumentWriterProjectionResult: async (documentId) => ({
          code: "document_not_found",
          kind: "http",
          message: `GET /documents/${documentId}/writer-projection: 404 Not Found`,
          method: "GET",
          ok: false,
          path: `/documents/${documentId}/writer-projection`,
          report: () => undefined,
          status: 404,
          statusText: "Not Found",
        }),
        syncDocumentResult: async () => {
          throw new Error("Unexpected sync after coded deletion");
        },
      }),
      auth: {
        isAuthenticated: true,
        organizationId: "org-a",
        userId: "user-a",
      },
      crypto: {
        encapsulationKeyPair,
        signingFingerprint,
        signingKeyPair,
      },
      infra: {
        blobStore: createMemoryBlobStore(),
        dbStatus: "ready",
        documentProjectors: defaultDocumentProjectorRegistry,
        execSql,
      },
      resolveTrustedUserIdentity: async () => null,
      state: {
        containerId: "root-a",
        domainScope: createDomainScope(),
        events: [],
        online: true,
      },
      util: { log: () => undefined },
    });
    const stores: Array<ReturnType<typeof openDocumentStore>> = [];

    const result = await probeUndiscoveredRemoteDocumentBatch({
      afterLocalId: null,
      host: {
        documentWorkflowRuntime: () => runtime,
        openDocumentStore: (input) => {
          const store = openDocumentStore(
            input.runtime.state.domainScope,
            input.localId,
            input.runtime,
            input.documentId,
          );
          stores.push(store);
          return store;
        },
      },
      listedContainerIds: new Set(["root-a"]),
      listedDocumentIds: new Set(),
      runtime: { infra: { execSql } },
    });

    expect(result.requestedCount).toBe(1);
    await waitFor(
      async () =>
        (await sqlDocumentsPersistence.loadDocument(
          execSql,
          "deleted-local",
        )) === null,
      "Coded deletion probe did not destroy the local document",
    );
    expect(stores).toHaveLength(1);
    expect(stores[0]?.getSnapshot().ready).toBe(false);
  } finally {
    close();
  }
});
