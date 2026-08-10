import { expect, test } from "bun:test";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import { waitFor } from "../../../test/helpers/waitFor";
import type { DomainScope } from "../../data/domainScope";
import { sqlDocumentContainerProjectionPersistence } from "../../data/persistence/containers/documentContainerProjectionPersistence";
import { upsertDiscoveredDocuments } from "../../data/persistence/documents/documentsPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import {
  createContainerParentSyncLane,
  defaultContainerContentsPersistence,
  markContainerSyncLaneChecked,
} from "../../workflows/container-contents/containerPersistence";
import { createContainerContentsStore } from "../container-contents/containerContentsStore";
import { createContainerContentsTestRuntime } from "../container-contents/runtime.testFixtures";
import type {
  ContainerContentsStore,
  ContainerNode,
} from "../container-contents/types";
import { createLocalProjectionStore } from "./localProjectionStore";

function createThrowingApiClient(): ReturnType<typeof createMockApiClient> {
  // Any remote call is a device-first violation in these tests.
  return createMockApiClient({
    listContainerParentLanes: async () => {
      throw new Error("network is forbidden in device-first read tests");
    },
    listContainerDocuments: async () => {
      throw new Error("network is forbidden in device-first read tests");
    },
  });
}

function createRuntime(input: {
  apiClient: ReturnType<typeof createMockApiClient>;
  domainScope: DomainScope;
  execSql: ExecSql;
  isAuthenticated: boolean;
  online: boolean;
  dbStatus?: string;
}): ReturnType<typeof createContainerContentsTestRuntime> {
  return createContainerContentsTestRuntime({
    apiClient: input.apiClient,
    dbStatus: input.dbStatus ?? "ready",
    domainScope: input.domainScope,
    execSql: input.execSql,
    isAuthenticated: input.isAuthenticated,
    online: input.online,
  });
}

function remoteContainerNode(id: string): ContainerNode {
  return {
    effectiveAccessLevel: "admin",
    id,
    kind: "container",
    metadataDocumentId: `${id}-metadata`,
    name: id,
    organizationId: "org-1",
    parentId: null,
    syncState: {
      lastError: null,
      pendingAttachmentBytes: 0,
      pendingAttachmentCount: 0,
      pendingUpdateCount: 0,
      status: "synced",
    },
    systemSlot: null,
  };
}

async function seedContainerWithDocument(
  execSql: ExecSql,
  input: { containerId: string; documentId: string },
): Promise<void> {
  await defaultContainerContentsPersistence.ensureSchema(execSql);
  await defaultContainerContentsPersistence.saveContainer(
    execSql,
    {
      effectiveAccessLevel: "admin",
      icon: null,
      id: input.containerId,
      metadataDocumentId: `${input.containerId}-metadata`,
      name: "/",
      organizationId: "org-1",
      parentId: null,
    },
    null,
  );
  // Mark the root lane fresh so startup hydration stays cache-first (no network).
  await markContainerSyncLaneChecked(
    execSql,
    createContainerParentSyncLane(null),
  );
  await markContainerSyncLaneChecked(
    execSql,
    createContainerParentSyncLane(input.containerId),
  );

  await upsertDiscoveredDocuments(execSql, [
    {
      accessEpoch: 1,
      accessStateHash: null,
      containerId: input.containerId,
      createdAt: "2026-01-01T00:00:00.000Z",
      documentId: input.documentId,
      linkedContainerIds: [input.containerId],
    },
  ]);
  await sqlDocumentContainerProjectionPersistence.replaceDocumentLinksBatch(
    execSql,
    [{ documentId: input.documentId, containerIds: [input.containerId] }],
  );
}

test("local projection store paints cached container documents without any network", async () => {
  const { close, execSql } = await createTestExecSql(
    "local-projection-device-first-read-test",
  );
  const domainScope = {} as DomainScope;

  try {
    await seedContainerWithDocument(execSql, {
      containerId: "cached-root",
      documentId: "doc-1",
    });

    const runtime = createRuntime({
      apiClient: createThrowingApiClient(),
      domainScope,
      execSql,
      isAuthenticated: true,
      online: true,
    });
    const containerStore = createContainerContentsStore(runtime);
    const store = createLocalProjectionStore({ containerStore, runtime });
    store.updateRuntime(runtime);

    await waitFor(
      () => store.getSnapshot().ready,
      "Local projection store did not become ready from cache.",
    );

    expect(store.getSnapshot().containers.map((node) => node.id)).toContain(
      "cached-root",
    );

    store.setActiveContainer("cached-root");

    await waitFor(() => {
      const summaries = store
        .getSnapshot()
        .documentSummariesByContainerId.get("cached-root");
      return (summaries?.length ?? 0) > 0;
    }, "Active container summaries were not loaded from cache.");

    const summaries = store
      .getSnapshot()
      .documentSummariesByContainerId.get("cached-root");
    expect(summaries?.map((summary) => summary.documentId)).toEqual(["doc-1"]);
  } finally {
    close();
  }
});

test("local projection store does not blank its snapshot when authentication is gained", async () => {
  const { close, execSql } = await createTestExecSql(
    "local-projection-auth-gain-no-reset-test",
  );
  const domainScope = {} as DomainScope;

  try {
    await seedContainerWithDocument(execSql, {
      containerId: "cached-root",
      documentId: "doc-1",
    });

    // Gaining auth legitimately schedules a background reconcile; allow the
    // benign empty remote responses. The point under test is that the snapshot
    // never blanks and cached summaries survive — not that no call is made.
    const apiClient = createMockApiClient();

    // Start unauthenticated: device-first reads must work offline/pre-auth.
    const unauthenticatedRuntime = createRuntime({
      apiClient,
      domainScope,
      execSql,
      isAuthenticated: false,
      online: false,
    });
    const containerStore = createContainerContentsStore(unauthenticatedRuntime);
    const store = createLocalProjectionStore({
      containerStore,
      runtime: unauthenticatedRuntime,
    });
    store.updateRuntime(unauthenticatedRuntime);

    await waitFor(
      () => store.getSnapshot().ready,
      "Local projection store did not become ready while unauthenticated.",
    );
    store.setActiveContainer("cached-root");
    await waitFor(() => {
      const summaries = store
        .getSnapshot()
        .documentSummariesByContainerId.get("cached-root");
      return (summaries?.length ?? 0) > 0;
    }, "Cached summaries were not loaded while unauthenticated.");

    let blanked = false;
    store.subscribe(() => {
      if (!store.getSnapshot().ready) {
        blanked = true;
      }
    });

    // Gain authentication — the exact transition that used to reset the store.
    const authenticatedRuntime = createRuntime({
      apiClient,
      domainScope,
      execSql,
      isAuthenticated: true,
      online: true,
    });
    store.updateRuntime(authenticatedRuntime);

    // Give any (incorrect) reset a chance to surface.
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(blanked).toBe(false);
    expect(store.getSnapshot().ready).toBe(true);
    expect(
      store
        .getSnapshot()
        .documentSummariesByContainerId.get("cached-root")
        ?.map((summary) => summary.documentId),
    ).toEqual(["doc-1"]);
  } finally {
    close();
  }
});

test("local projection store raises an active-changed reconcile signal", async () => {
  const { close, execSql } = await createTestExecSql(
    "local-projection-reconcile-signal-test",
  );
  const domainScope = {} as DomainScope;

  try {
    await seedContainerWithDocument(execSql, {
      containerId: "cached-root",
      documentId: "doc-1",
    });
    const runtime = createRuntime({
      apiClient: createThrowingApiClient(),
      domainScope,
      execSql,
      isAuthenticated: true,
      online: true,
    });
    const containerStore = createContainerContentsStore(runtime);
    const store = createLocalProjectionStore({ containerStore, runtime });

    const signals: Array<string | null> = [];
    store.onReconcileSignal((signal) => {
      signals.push(signal.activeContainerId);
    });

    store.updateRuntime(runtime);
    await waitFor(
      () => store.getSnapshot().ready,
      "Local projection store did not become ready.",
    );

    store.setActiveContainer("cached-root");
    expect(signals).toContain("cached-root");
  } finally {
    close();
  }
});

test("local projection store raises hydrated when local tree initialization finishes", async () => {
  const { close, execSql } = await createTestExecSql(
    "local-projection-async-hydrated-signal-test",
  );
  const domainScope = {} as DomainScope;

  try {
    await seedContainerWithDocument(execSql, {
      containerId: "cached-root",
      documentId: "doc-1",
    });
    const runtime = createRuntime({
      apiClient: createThrowingApiClient(),
      domainScope,
      execSql,
      isAuthenticated: true,
      online: true,
    });
    const containerStore = createContainerContentsStore(runtime);
    const store = createLocalProjectionStore({ containerStore, runtime });
    const signals: string[] = [];
    store.onReconcileSignal((signal) => {
      signals.push(signal.reason);
    });

    store.updateRuntime(runtime);

    await waitFor(
      () => signals.includes("hydrated"),
      "Local projection store did not raise hydrated after local tree initialization.",
    );
    expect(store.getSnapshot().ready).toBe(true);
  } finally {
    close();
  }
});

test("remote container growth re-arms backfill after initial hydration only", async () => {
  const { close, execSql } = await createTestExecSql(
    "local-projection-remote-container-growth-signal-test",
  );
  const domainScope = {} as DomainScope;

  try {
    const runtime = createRuntime({
      apiClient: createThrowingApiClient(),
      domainScope,
      execSql,
      isAuthenticated: true,
      online: true,
    });
    const cachedRoot = remoteContainerNode("cached-root");
    const localFirstChild: ContainerNode = {
      ...remoteContainerNode("promoting-child"),
      metadataDocumentId: null,
      parentId: cachedRoot.id,
      syncState: {
        lastError: null,
        pendingAttachmentBytes: 0,
        pendingAttachmentCount: 0,
        pendingUpdateCount: 1,
        status: "pending",
      },
    };
    let nodes: ReadonlyArray<ContainerNode> = [cachedRoot, localFirstChild];
    let emitContainerStore = () => {};
    const containerStore = {
      getSnapshot: () => ({ nodes, ready: true }),
      subscribe: (listener: () => void) => {
        emitContainerStore = listener;
        return () => {
          emitContainerStore = () => {};
        };
      },
      updateRuntime: () => {},
    } as unknown as ContainerContentsStore;
    const store = createLocalProjectionStore({ containerStore, runtime });
    const signals: string[] = [];
    store.onReconcileSignal((signal) => signals.push(signal.reason));

    // A warm cached tree becoming ready emits only the normal hydration signal;
    // it must not turn every startup into a full document backfill.
    store.updateRuntime(runtime);
    expect(signals).toEqual(["hydrated"]);

    // A newly discovered remote child re-arms the cold-recovery backfill.
    nodes = [...nodes, remoteContainerNode("remote-contacts")];
    emitContainerStore();
    expect(signals).toEqual(["hydrated", "remote-containers-added"]);

    // A local-first child becoming remotely listable under the same id must
    // signal one trailing backfill. This is the active-container promotion
    // race: its earlier local-only queue item was deliberately discarded.
    nodes = [
      cachedRoot,
      {
        ...localFirstChild,
        metadataDocumentId: "promoting-child-metadata",
        syncState: {
          ...localFirstChild.syncState,
          pendingUpdateCount: 0,
          status: "synced",
        },
      },
    ];
    emitContainerStore();
    expect(signals).toEqual([
      "hydrated",
      "remote-containers-added",
      "remote-containers-added",
    ]);

    nodes = [...nodes];
    emitContainerStore();
    expect(signals).toHaveLength(3);
  } finally {
    close();
  }
});

test("local projection store resets summaries when the database goes away", async () => {
  const { close, execSql } = await createTestExecSql(
    "local-projection-db-loss-reset-test",
  );
  const domainScope = {} as DomainScope;

  try {
    await seedContainerWithDocument(execSql, {
      containerId: "cached-root",
      documentId: "doc-1",
    });
    const runtime = createRuntime({
      apiClient: createMockApiClient(),
      domainScope,
      execSql,
      isAuthenticated: true,
      online: true,
    });
    const containerStore = createContainerContentsStore(runtime);
    const store = createLocalProjectionStore({ containerStore, runtime });
    store.updateRuntime(runtime);
    await waitFor(
      () => store.getSnapshot().ready,
      "Local projection store did not become ready.",
    );
    store.setActiveContainer("cached-root");
    await waitFor(() => {
      const summaries = store
        .getSnapshot()
        .documentSummariesByContainerId.get("cached-root");
      return (summaries?.length ?? 0) > 0;
    }, "Cached summaries were not loaded.");

    // Database goes away: the store must reset to not-ready and drop summaries,
    // and any in-flight summary load must not repopulate the reset cache.
    store.updateRuntime(
      createRuntime({
        apiClient: createMockApiClient(),
        domainScope,
        execSql,
        isAuthenticated: true,
        online: true,
        dbStatus: "terminated",
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(store.getSnapshot().ready).toBe(false);
    expect(
      store.getSnapshot().documentSummariesByContainerId.get("cached-root") ??
        [],
    ).toEqual([]);
  } finally {
    close();
  }
});
