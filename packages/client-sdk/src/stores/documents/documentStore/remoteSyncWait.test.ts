import { expect, test } from "bun:test";
import { createMockApiClient, createTestExecSql } from "@symcrypt/test-utils";
import { createMaterializedSyncFixture } from "../../../../test/helpers/documentFixtures";
import {
  createProbeRuntime,
  settleWithin,
} from "../../../../test/helpers/remoteSyncWait";
import { createMemoryBlobStore } from "../../../data/blobs/memoryBlobStore";
import { defaultDocumentProjectorRegistry } from "../../../data/documents/documentKinds";
import { createDomainScope } from "../../../data/domainScope";
import {
  disposeDomainSyncCoordinator,
  getDomainSyncCoordinatorSnapshot,
} from "../../../data/sync/syncCoordinator";
import {
  createDocumentsWorkflowRuntime,
  type DocumentsPersistence,
  type DocumentsWorkflowRuntimeInput,
  defaultDocumentsPersistence,
} from "../../../workflows/documents";
import { createDocumentStore } from "../documentStore";
import { createRemoteHistoryFixture } from "./documentStore.testFixtures";

function createUnavailableRuntime(
  execSql: DocumentsWorkflowRuntimeInput["infra"]["execSql"],
) {
  return createDocumentsWorkflowRuntime({
    apiClient: createMockApiClient(),
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
      blobStore: createMemoryBlobStore(),
      dbStatus: "ready",
      documentProjectors: defaultDocumentProjectorRegistry,
      execSql,
    },
    resolveTrustedUserIdentity: async () => null,
    state: {
      containerId: "container-id",
      domainScope: createDomainScope(),
      events: [],
      online: true,
    },
    util: {
      log: () => undefined,
      reportSecurityIncident: async () => undefined,
    },
  });
}

async function settleCoordinator(
  domainScope: ReturnType<typeof createDomainScope>,
): Promise<void> {
  for (let index = 0; index < 100; index += 1) {
    const lanes = getDomainSyncCoordinatorSnapshot(domainScope).lanes;
    if (lanes.every((lane) => !lane.running && !lane.requested)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for the document sync lane to settle");
}

test("a probe skipped for unavailable prerequisites reports incomplete", async () => {
  const database = await createTestExecSql("remote-sync-wait-unavailable");
  const runtime = createUnavailableRuntime(database.execSql);
  try {
    await defaultDocumentsPersistence.ensureSchema(database.execSql);
    const store = createDocumentStore(
      "unavailable-profile",
      runtime,
      defaultDocumentsPersistence,
      "remote-profile-id",
    );
    expect(await store.ensureInitialized()).toBe(true);

    expect(await settleWithin(store.requestRemoteSyncAndWait())).toBe(false);
  } finally {
    disposeDomainSyncCoordinator(runtime.state.domainScope);
    database.close();
  }
});

test("a graceful null remote probe reports incomplete", async () => {
  const fixture = await createMaterializedSyncFixture();
  const database = await createTestExecSql("remote-sync-wait-null");
  let syncCalls = 0;
  const runtime = createProbeRuntime({
    execSql: database.execSql,
    fixture,
    syncDocument: async () => {
      syncCalls += 1;
      return null;
    },
  });
  try {
    await defaultDocumentsPersistence.ensureSchema(database.execSql);
    const store = createDocumentStore(
      "null-profile",
      runtime,
      defaultDocumentsPersistence,
      fixture.writerProjection.documentId,
    );
    expect(await store.ensureInitialized()).toBe(true);

    expect(await settleWithin(store.requestRemoteSyncAndWait())).toBe(false);
    expect(syncCalls).toBeGreaterThan(0);

    const previousSyncCalls = syncCalls;
    disposeDomainSyncCoordinator(runtime.state.domainScope);
    expect(await settleWithin(store.requestRemoteSyncAndWait())).toBe(false);
    expect(syncCalls).toBeGreaterThan(previousSyncCalls);
  } finally {
    disposeDomainSyncCoordinator(runtime.state.domainScope);
    database.close();
  }
});

test("an abort during initialization stays blocked until a normal reopen", async () => {
  const fixture = await createMaterializedSyncFixture();
  const database = await createTestExecSql("remote-sync-wait-initializing");
  const localId = "initializing-profile";
  const seedRuntime = createUnavailableRuntime(database.execSql);
  let releaseLoad: () => void = () => undefined;
  const loadGate = new Promise<void>((resolve) => {
    releaseLoad = resolve;
  });
  let markLoadStarted: () => void = () => undefined;
  const loadStarted = new Promise<void>((resolve) => {
    markLoadStarted = resolve;
  });
  let syncCalls = 0;
  const runtime = createProbeRuntime({
    execSql: database.execSql,
    fixture,
    syncDocument: async () => {
      syncCalls += 1;
      return null;
    },
  });
  const gatedPersistence: DocumentsPersistence = {
    ...defaultDocumentsPersistence,
    async loadDocumentStoreState(execSql, requestedLocalId) {
      markLoadStarted();
      await loadGate;
      return defaultDocumentsPersistence.loadDocumentStoreState(
        execSql,
        requestedLocalId,
      );
    },
  };
  try {
    await defaultDocumentsPersistence.ensureSchema(database.execSql);
    const seedStore = createDocumentStore(
      localId,
      seedRuntime,
      defaultDocumentsPersistence,
      fixture.writerProjection.documentId,
    );
    expect(await seedStore.ensureInitialized()).toBe(true);
    disposeDomainSyncCoordinator(seedRuntime.state.domainScope);

    const store = createDocumentStore(
      localId,
      runtime,
      gatedPersistence,
      fixture.writerProjection.documentId,
    );
    const initialization = store.ensureInitialized();
    await settleWithin(loadStarted, "initialization load");
    const abortController = new AbortController();
    const result = store.requestRemoteSyncAndWait(abortController.signal);

    abortController.abort();
    expect(await settleWithin(result, "initialization abort")).toBe(false);
    releaseLoad();

    expect(await initialization).toBe(true);
    await settleCoordinator(runtime.state.domainScope);
    expect(syncCalls).toBe(0);

    store.requestSync();
    await settleCoordinator(runtime.state.domainScope);
    expect(syncCalls).toBe(1);
  } finally {
    releaseLoad();
    disposeDomainSyncCoordinator(seedRuntime.state.domainScope);
    disposeDomainSyncCoordinator(runtime.state.domainScope);
    database.close();
  }
});

test("aborting an in-flight probe prevents its late response from persisting", async () => {
  const fixture = await createRemoteHistoryFixture();
  const database = await createTestExecSql("remote-sync-wait-abort");
  let releaseResponse: () => void = () => undefined;
  const responseGate = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  let markSyncStarted: () => void = () => undefined;
  const syncStarted = new Promise<void>((resolve) => {
    markSyncStarted = resolve;
  });
  let syncCalls = 0;
  const runtime = createProbeRuntime({
    execSql: database.execSql,
    fixture,
    syncDocument: async () => {
      syncCalls += 1;
      markSyncStarted();
      await responseGate;
      return fixture.response;
    },
  });
  try {
    await defaultDocumentsPersistence.ensureSchema(database.execSql);
    const store = createDocumentStore(
      "aborted-profile",
      runtime,
      defaultDocumentsPersistence,
      fixture.writerProjection.documentId,
    );
    expect(await store.ensureInitialized()).toBe(true);
    const abortController = new AbortController();
    const result = store.requestRemoteSyncAndWait(abortController.signal);
    await settleWithin(syncStarted);

    abortController.abort();
    releaseResponse();

    expect(await settleWithin(result)).toBe(false);
    await settleCoordinator(runtime.state.domainScope);
    const persisted = await defaultDocumentsPersistence.loadDocumentStoreState(
      database.execSql,
      "aborted-profile",
    );
    expect(syncCalls).toBe(1);
    expect(persisted.document?.text).toBe("");
    expect(store.getSnapshot().text).toBe("");
  } finally {
    releaseResponse();
    disposeDomainSyncCoordinator(runtime.state.domainScope);
    database.close();
  }
});

test("aborting one waiter preserves a concurrent remote probe", async () => {
  const fixture = await createRemoteHistoryFixture();
  const database = await createTestExecSql("remote-sync-wait-concurrent-abort");
  let releaseResponse: () => void = () => undefined;
  const responseGate = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  let markSyncStarted: () => void = () => undefined;
  const syncStarted = new Promise<void>((resolve) => {
    markSyncStarted = resolve;
  });
  const runtime = createProbeRuntime({
    execSql: database.execSql,
    fixture,
    syncDocument: async () => {
      markSyncStarted();
      await responseGate;
      return fixture.response;
    },
  });
  try {
    await defaultDocumentsPersistence.ensureSchema(database.execSql);
    const store = createDocumentStore(
      "concurrent-abort-profile",
      runtime,
      defaultDocumentsPersistence,
      fixture.writerProjection.documentId,
    );
    expect(await store.ensureInitialized()).toBe(true);
    const abortController = new AbortController();
    const aborted = store.requestRemoteSyncAndWait(abortController.signal);
    const live = store.requestRemoteSyncAndWait();
    await settleWithin(syncStarted);

    abortController.abort();
    releaseResponse();

    expect(await settleWithin(aborted)).toBe(false);
    expect(await settleWithin(live)).toBe(true);
    const persisted = await defaultDocumentsPersistence.loadDocumentStoreState(
      database.execSql,
      "concurrent-abort-profile",
    );
    expect(persisted.document?.text).toBe("survives key rotation");
  } finally {
    releaseResponse();
    disposeDomainSyncCoordinator(runtime.state.domainScope);
    database.close();
  }
});

test("a stale waiter cannot mask cancellation of the current generation", async () => {
  const fixture = await createRemoteHistoryFixture();
  const database = await createTestExecSql(
    "remote-sync-wait-stale-owner-cancellation",
  );
  let releaseResponse: () => void = () => undefined;
  const responseGate = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  let markSyncStarted: () => void = () => undefined;
  const syncStarted = new Promise<void>((resolve) => {
    markSyncStarted = resolve;
  });
  let syncCalls = 0;
  const runtime = createProbeRuntime({
    execSql: database.execSql,
    fixture,
    syncDocument: async () => {
      syncCalls += 1;
      if (syncCalls === 1) {
        markSyncStarted();
        await responseGate;
      }
      return null;
    },
  });
  const localId = "stale-owner-cancellation-profile";
  try {
    await defaultDocumentsPersistence.ensureSchema(database.execSql);
    const store = createDocumentStore(
      localId,
      runtime,
      defaultDocumentsPersistence,
      fixture.writerProjection.documentId,
    );
    expect(await store.ensureInitialized()).toBe(true);

    const staleWaiter = store.requestRemoteSyncAndWait();
    await settleWithin(syncStarted);
    expect(
      await store.relink({
        accessEpoch: 2,
        containerId: fixture.projection.containerId,
        documentId: "relinked-profile-id",
        localId,
      }),
    ).not.toBeNull();

    const abortController = new AbortController();
    const currentWaiter = store.requestRemoteSyncAndWait(
      abortController.signal,
    );
    abortController.abort();
    expect(await settleWithin(currentWaiter)).toBe(false);

    releaseResponse();
    expect(await settleWithin(staleWaiter)).toBe(false);
    await settleCoordinator(runtime.state.domainScope);
    expect(syncCalls).toBe(1);
  } finally {
    releaseResponse();
    disposeDomainSyncCoordinator(runtime.state.domainScope);
    database.close();
  }
});

test("aborting the last waiter preserves a concurrent manual refresh", async () => {
  const fixture = await createRemoteHistoryFixture();
  const database = await createTestExecSql(
    "remote-sync-wait-manual-refresh-abort",
  );
  let releaseResponse: () => void = () => undefined;
  const responseGate = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  let markSyncStarted: () => void = () => undefined;
  const syncStarted = new Promise<void>((resolve) => {
    markSyncStarted = resolve;
  });
  let syncCalls = 0;
  const runtime = createProbeRuntime({
    execSql: database.execSql,
    fixture,
    syncDocument: async () => {
      syncCalls += 1;
      if (syncCalls === 1) {
        markSyncStarted();
        await responseGate;
      }
      return fixture.response;
    },
  });
  try {
    await defaultDocumentsPersistence.ensureSchema(database.execSql);
    const store = createDocumentStore(
      "manual-refresh-abort-profile",
      runtime,
      defaultDocumentsPersistence,
      fixture.writerProjection.documentId,
    );
    expect(await store.ensureInitialized()).toBe(true);
    const abortController = new AbortController();
    const aborted = store.requestRemoteSyncAndWait(abortController.signal);
    await settleWithin(syncStarted);

    store.requestRemoteSync();
    abortController.abort();
    releaseResponse();

    expect(await settleWithin(aborted)).toBe(false);
    await settleCoordinator(runtime.state.domainScope);
    const persisted = await defaultDocumentsPersistence.loadDocumentStoreState(
      database.execSql,
      "manual-refresh-abort-profile",
    );
    expect(syncCalls).toBeGreaterThanOrEqual(2);
    expect(persisted.document?.text).toBe("survives key rotation");
  } finally {
    releaseResponse();
    disposeDomainSyncCoordinator(runtime.state.domainScope);
    database.close();
  }
});

test("aborting a waiter preserves every page of an independent refresh", async () => {
  const fixture = await createRemoteHistoryFixture();
  const database = await createTestExecSql(
    "remote-sync-wait-paginated-refresh-abort",
  );
  let releaseFinalPage: () => void = () => undefined;
  const finalPageGate = new Promise<void>((resolve) => {
    releaseFinalPage = resolve;
  });
  let markFinalPageStarted: () => void = () => undefined;
  const finalPageStarted = new Promise<void>((resolve) => {
    markFinalPageStarted = resolve;
  });
  let syncCalls = 0;
  const runtime = createProbeRuntime({
    execSql: database.execSql,
    fixture,
    syncDocument: async () => {
      syncCalls += 1;
      if (syncCalls === 1) {
        return {
          ...fixture.response,
          pullPage: { hasMore: true, nextCursor: "profile-page-2" },
          updates: [],
        };
      }
      if (syncCalls === 2) {
        markFinalPageStarted();
        await finalPageGate;
        return fixture.response;
      }
      return {
        ...fixture.response,
        updates: [],
      };
    },
  });
  try {
    await defaultDocumentsPersistence.ensureSchema(database.execSql);
    const store = createDocumentStore(
      "paginated-refresh-abort-profile",
      runtime,
      defaultDocumentsPersistence,
      fixture.writerProjection.documentId,
    );
    expect(await store.ensureInitialized()).toBe(true);

    store.requestRemoteSync();
    await settleWithin(finalPageStarted, "final continuation page");

    const abortController = new AbortController();
    const aborted = store.requestRemoteSyncAndWait(abortController.signal);
    abortController.abort();
    expect(await settleWithin(aborted)).toBe(false);

    releaseFinalPage();
    await settleCoordinator(runtime.state.domainScope);

    const persisted = await defaultDocumentsPersistence.loadDocumentStoreState(
      database.execSql,
      "paginated-refresh-abort-profile",
    );
    expect(syncCalls).toBeGreaterThanOrEqual(2);
    expect(persisted.document?.text).toBe("survives key rotation");
  } finally {
    releaseFinalPage();
    disposeDomainSyncCoordinator(runtime.state.domainScope);
    database.close();
  }
});
