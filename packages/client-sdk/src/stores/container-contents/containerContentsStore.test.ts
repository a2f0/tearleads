import { expect, test } from "bun:test";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import type { ListContainersResponse } from "@tearleads/validators/response";
import type { BlobStore } from "../../data/blobContracts";
import { defaultDocumentProjectorRegistry } from "../../data/documents/documentKinds";
import type { DomainScope } from "../../data/domainScope";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import {
  type ContainerContentsPersistence,
  createContainerParentSyncLane,
  defaultContainerContentsPersistence,
  loadContainerSyncLaneCheckRecords,
  markContainerSyncLaneChecked,
} from "../../workflows/container-contents/containerPersistence";
import { createContainerContentsWorkflowRuntime } from "../../workflows/container-contents/runtime";
import {
  createContainerContentsStore,
  getOrCreateContainerContentsStore,
} from "./containerContentsStore";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolveValue: ((value: T) => void) | null = null;
  const promise = new Promise<T>((resolve) => {
    resolveValue = resolve;
  });

  return {
    promise,
    resolve: (value) => {
      if (!resolveValue) {
        throw new Error("Deferred promise was not initialized.");
      }

      resolveValue(value);
    },
  };
}

function emptyListContainersResponse(): ListContainersResponse {
  return {
    hasMore: false,
    items: [],
    nextWatermark: null,
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

function createTestRuntime(input: {
  domainScope: DomainScope;
  log: (message: string) => void;
}) {
  const execSql: ExecSql = async () => {
    throw new Error("Unexpected SQL call in container contents store test.");
  };

  return createContainerContentsWorkflowRuntime({
    apiClient: {} as Parameters<
      typeof createContainerContentsWorkflowRuntime
    >[0]["apiClient"],
    auth: {
      isAuthenticated: false,
      organizationId: null,
      userId: null,
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
      execSql,
    },
    state: {
      containerId: null,
      domainScope: input.domainScope,
      events: [],
      online: false,
    },
    util: {
      cacheReferencedPrincipalPolicies: async () => {},
      log: input.log,
    },
  });
}

function createSqlTestRuntime(input: {
  apiClient: ReturnType<typeof createMockApiClient>;
  domainScope: DomainScope;
  execSql: ExecSql;
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
      containerId: null,
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

test("getOrCreateContainerContentsStore applies updated options to the cached scope store", async () => {
  const domainScope = {} as DomainScope;
  const logs: string[] = [];
  let ensureSchemaCalls = 0;
  let loadContainersCalls = 0;
  const persistence: ContainerContentsPersistence = {
    ...defaultContainerContentsPersistence,
    ensureSchema: async () => {
      ensureSchemaCalls += 1;
    },
    loadContainers: async () => {
      loadContainersCalls += 1;
      return [];
    },
  };
  const runtime = createTestRuntime({
    domainScope,
    log: (message) => logs.push(message),
  });

  const store = getOrCreateContainerContentsStore(domainScope, runtime, {
    logLabel: "Initial label",
  });
  const sameStore = getOrCreateContainerContentsStore(domainScope, runtime, {
    logLabel: "Updated label",
    persistence,
  });

  expect(sameStore).toBe(store);

  const initialized = new Promise<void>((resolve) => {
    const unsubscribe = sameStore.subscribe(() => {
      if (sameStore.getSnapshot().ready) {
        unsubscribe();
        resolve();
      }
    });
  });
  sameStore.updateRuntime(runtime);
  await initialized;

  expect(ensureSchemaCalls).toBe(1);
  expect(loadContainersCalls).toBe(1);
  expect(logs).toContain("Updated label: loaded 0 container(s)");
});

test("container contents store publishes cached containers before startup hydration completes", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-contents-store-cache-first-startup-test",
  );
  const domainScope = {} as DomainScope;
  const listedContainers = createDeferred<ListContainersResponse>();
  let listContainersStarted = 0;
  let listContainersSettled = 0;

  try {
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    await defaultContainerContentsPersistence.saveContainer(
      execSql,
      {
        icon: null,
        id: "cached-root",
        metadataDocumentId: "cached-root-metadata-document",
        name: "/",
        organizationId: "org-1",
        parentId: null,
      },
      null,
    );
    await markContainerSyncLaneChecked(
      execSql,
      createContainerParentSyncLane(null),
    );
    await execSql(
      "UPDATE container_sync_lane_checks SET checked_at = ? WHERE lane_kind = ? AND lane_id = ?",
      ["2026-01-01T00:00:00.000Z", "container_parent", "root"],
    );

    const runtime = createSqlTestRuntime({
      apiClient: createMockApiClient({
        listContainers: async () => {
          listContainersStarted += 1;
          const response = await listedContainers.promise;
          listContainersSettled += 1;
          return response;
        },
      }),
      domainScope,
      execSql,
    });
    const store = createContainerContentsStore(runtime);

    store.updateRuntime(runtime);

    await waitForCondition(
      () => store.getSnapshot().ready,
      "Container contents store did not become ready.",
    );

    expect(store.getSnapshot().nodes.map((node) => node.id)).toContain(
      "cached-root",
    );
    expect(listContainersSettled).toBe(0);

    if (listContainersStarted === 0) {
      await waitForCondition(
        () => listContainersStarted > 0,
        "Startup hydration was not scheduled.",
      );
    }
    listedContainers.resolve(emptyListContainersResponse());
    await waitForCondition(
      () =>
        listContainersStarted > 0 &&
        listContainersSettled === listContainersStarted,
      "Startup hydration did not settle.",
    );
    await waitForCondition(async () => {
      const checks = await loadContainerSyncLaneCheckRecords(execSql, [
        createContainerParentSyncLane(null),
      ]);
      return checks.every((check) => check !== null);
    }, "Startup hydration did not save lane check markers.");
  } finally {
    close();
  }
});
