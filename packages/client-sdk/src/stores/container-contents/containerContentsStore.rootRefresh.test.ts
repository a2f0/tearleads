import { expect, test } from "bun:test";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import type { ListContainersResponse } from "@tearleads/validators/response";
import type { BlobStore } from "../../data/blobContracts";
import { defaultDocumentProjectorRegistry } from "../../data/documents/documentKinds";
import type { DomainScope } from "../../data/domainScope";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { defaultContainerContentsPersistence } from "../../workflows/container-contents/containerPersistence";
import { createContainerContentsWorkflowRuntime } from "../../workflows/container-contents/runtime";
import { createContainerContentsStore } from "./containerContentsStore";

function emptyListContainersResponse(): ListContainersResponse {
  return {
    hasMore: false,
    items: [],
    nextWatermark: null,
    tombstones: [],
  };
}

function activeRootChildSummary(): ListContainersResponse {
  return {
    hasMore: false,
    items: [
      {
        createdAt: "2026-06-19T00:00:00.000Z",
        depth: 1,
        effectiveAccessLevel: "admin",
        id: "active-root-trash",
        metadataAccessEpoch: 1,
        metadataAccessStateHash: "active-root-trash-access-hash",
        metadataDocumentId: "active-root-trash-metadata-document",
        organizationId: "org-1",
        parentId: "active-root",
        systemSlot: "sys_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        updatedAt: "2026-06-19T00:00:00.000Z",
      },
    ],
    nextWatermark: {
      id: "active-root-trash",
      updatedAt: "2026-06-19T00:00:00.000Z",
    },
    tombstones: [],
  };
}

async function waitForCondition(
  predicate: () => boolean | Promise<boolean>,
  message: string,
): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (Date.now() <= deadline) {
    if (await predicate()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(message);
}

function createSqlTestRuntime(input: {
  apiClient: ReturnType<typeof createMockApiClient>;
  domainScope: DomainScope;
  execSql: ExecSql;
  rootContainerId: string;
}) {
  return createContainerContentsWorkflowRuntime({
    apiClient: input.apiClient,
    auth: {
      isAuthenticated: true,
      organizationId: "org-1",
      userId: "user-1",
    },
    crypto: {
      encapsulationKeyPair: null,
      signingFingerprint: null,
      signingKeyPair: null,
    },
    infra: {
      blobStore: {} as BlobStore,
      dbStatus: "ready",
      documentProjectors: defaultDocumentProjectorRegistry,
      execSql: input.execSql,
    },
    state: {
      containerId: input.rootContainerId,
      domainScope: input.domainScope,
      events: [],
      online: true,
    },
    util: {
      cacheReferencedPrincipalPolicies: async () => {},
      log: () => {},
    },
  });
}

test("root-lane refresh hydrates the active root's system children", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-contents-store-active-root-child-refresh-test",
  );
  const domainScope = {} as DomainScope;
  const parentIds: Array<string | null | undefined> = [];

  try {
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    await defaultContainerContentsPersistence.saveContainer(
      execSql,
      {
        icon: null,
        id: "active-root",
        effectiveAccessLevel: "admin",
        metadataDocumentId: "active-root-metadata-document",
        name: "/",
        organizationId: "org-1",
        parentId: null,
      },
      null,
    );

    const runtime = createSqlTestRuntime({
      apiClient: createMockApiClient({
        listContainers: async ({ parentId } = {}) => {
          parentIds.push(parentId);
          return parentId === "active-root"
            ? activeRootChildSummary()
            : emptyListContainersResponse();
        },
      }),
      domainScope,
      execSql,
      rootContainerId: "active-root",
    });
    const store = createContainerContentsStore(runtime);

    store.updateRuntime(runtime);

    await waitForCondition(
      () => store.getSnapshot().ready,
      "Container contents store did not become ready.",
    );

    await store.refreshRootLane({ includeActiveRootChildLane: true });

    expect(parentIds).toContain(null);
    expect(parentIds).toContain("active-root");
    expect(store.getSnapshot().nodes.map((node) => node.id)).toContain(
      "active-root-trash",
    );
  } finally {
    close();
  }
});
