import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair, toFingerprint } from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { parseEnvelope } from "@tearleads/loro";
import {
  execDatabaseStatement,
  initDatabase,
} from "@tearleads/sqlite-worker/load-sqlite3";
import { waitForCondition } from "../../../test/helpers/waitForCondition";
import {
  ensureContainerTables,
  loadContainers,
  saveContainer,
} from "../../data/containerPersistence";
import { createExplorerStore } from "./ExplorerProvider";

type ExplorerRuntime = Parameters<typeof createExplorerStore>[0];
type TestRuntime = ExplorerRuntime & { close: () => void };

async function createSqlRuntime(): Promise<TestRuntime> {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = Bun.fetch;
  const dbStatus: ExplorerRuntime["dbStatus"] = "ready";

  let db: Awaited<ReturnType<typeof initDatabase>>;
  try {
    db = await initDatabase({
      dbName: `/${crypto.randomUUID()}.db`,
      cipher: "chacha20",
      key: "explorer-provider-test",
    });
  } finally {
    globalThis.fetch = previousFetch;
  }

  return {
    apiClient: {
      createContainer: async (
        _id: string,
        _parentId: string,
        _initialMetadataUpdates,
      ) => null,
      listContainers: async () => [],
      shareContainer: async (
        _containerId: string,
        _subjectType: "user" | "group" | "organization",
        _subjectId: string,
        _accessLevel: "read" | "write" | "admin",
      ) => null,
      syncDocument: async () => null,
    },
    close: () => db.close(),
    dbStatus,
    domainScope: {},
    encapsulationKeyPair: null,
    events: [],
    execSql: async (
      sql: string,
      bind?: Record<string, string | number | null>,
    ) => execDatabaseStatement(db, bind ? { bind, sql } : { sql }),
    isAuthenticated: false,
    log: () => {},
    online: false,
  };
}

test("explorer store creates, renames, deletes, and reloads child containers", async () => {
  const runtime = await createSqlRuntime();

  try {
    await ensureContainerTables(runtime.execSql);
    await saveContainer(runtime.execSql, {
      id: "root-container",
      organizationId: "org-1",
      parentId: null,
      metadataDocumentId: null,
      name: "/",
      icon: null,
    });

    const firstStore = createExplorerStore(runtime);
    firstStore.updateRuntime(runtime);

    await waitForCondition(
      () => firstStore.getSnapshot().ready,
      "Explorer store did not become ready.",
    );

    expect(firstStore.getSnapshot()).toEqual({
      nodes: [
        {
          id: "root-container",
          kind: "container",
          name: "/",
          organizationId: "org-1",
          parentId: null,
        },
      ],
      ready: true,
    });

    const childNode = await firstStore.createChild("root-container", "Docs");
    if (!childNode) {
      throw new Error("Expected createChild to return a new container node.");
    }

    expect(childNode.name).toBe("Docs");
    expect(childNode.organizationId).toBe("org-1");
    expect(childNode.parentId).toBe("root-container");
    expect(firstStore.getSnapshot().nodes).toHaveLength(2);
    expect(
      firstStore
        .getSnapshot()
        .nodes.some(
          (node) =>
            node.id === childNode.id && node.parentId === "root-container",
        ),
    ).toBe(true);

    const renamedNode = await firstStore.renameContainer(
      childNode.id,
      "Manuals",
    );
    if (!renamedNode) {
      throw new Error("Expected renameContainer to return the renamed node.");
    }

    expect(renamedNode.id).toBe(childNode.id);
    expect(renamedNode.name).toBe("Manuals");
    expect(
      firstStore
        .getSnapshot()
        .nodes.some(
          (node) => node.id === childNode.id && node.name === "Manuals",
        ),
    ).toBe(true);

    const deletedRoot = await firstStore.deleteContainer("root-container");
    expect(deletedRoot).toBe(false);

    const deletedChild = await firstStore.deleteContainer(childNode.id);
    expect(deletedChild).toBe(true);
    expect(firstStore.getSnapshot().nodes).toHaveLength(1);
    expect(
      firstStore.getSnapshot().nodes.some((node) => node.id === childNode.id),
    ).toBe(false);

    const secondStore = createExplorerStore(runtime);
    secondStore.updateRuntime(runtime);

    await waitForCondition(
      () => secondStore.getSnapshot().ready,
      "Reloaded explorer store did not become ready.",
    );

    expect(secondStore.getSnapshot().nodes).toHaveLength(1);
    expect(
      secondStore.getSnapshot().nodes.some((node) => node.id === childNode.id),
    ).toBe(false);
  } finally {
    runtime.close();
  }
});

test("explorer store creates authenticated child containers through the API before persisting locally", async () => {
  const runtime = await createSqlRuntime();
  const createContainerCalls: Array<{
    id: string;
    initialMetadataUpdateCount: number;
    parentId: string;
  }> = [];

  runtime.isAuthenticated = true;
  runtime.encapsulationKeyPair = generateKemSeedAndKeyPair();
  runtime.apiClient = {
    createContainer: async (
      id: string,
      parentId: string,
      initialMetadataUpdates,
    ) => {
      createContainerCalls.push({
        id,
        initialMetadataUpdateCount: initialMetadataUpdates.length,
        parentId,
      });
      return {
        id,
        metadataAccessEpoch: 1,
        metadataDocumentId: "metadata-document-1",
        metadataRecipientEncapsulationPublicKeys: [],
        organizationId: "org-1",
        parentId,
      };
    },
    listContainers: async () => [],
    shareContainer: async () => null,
    syncDocument: async () => null,
  };
  try {
    await ensureContainerTables(runtime.execSql);
    await saveContainer(runtime.execSql, {
      id: "root-container",
      organizationId: "org-1",
      parentId: null,
      metadataDocumentId: null,
      name: "/",
      icon: null,
    });

    const store = createExplorerStore(runtime);
    store.updateRuntime(runtime);

    await waitForCondition(
      () => store.getSnapshot().ready,
      "Explorer store did not become ready.",
    );

    const childNode = await store.createChild("root-container", "Docs");
    if (!childNode) {
      throw new Error("Expected createChild to return a new container node.");
    }

    expect(createContainerCalls).toEqual([
      {
        id: childNode.id,
        initialMetadataUpdateCount: 1,
        parentId: "root-container",
      },
    ]);

    const persistedContainers = await loadContainers(runtime.execSql);
    const persistedChild = persistedContainers.find(
      (container) => container.id === childNode.id,
    );

    expect(persistedChild).not.toBeUndefined();
    expect(persistedChild?.metadataDocumentId).toBe("metadata-document-1");
    expect(persistedChild?.name).toBe("Docs");
    expect(childNode.organizationId).toBe("org-1");
    expect(childNode.parentId).toBe("root-container");
  } finally {
    runtime.close();
  }
});

test("explorer store creates a child under a writable shared root using the inherited recipient set", async () => {
  const runtime = await createSqlRuntime();
  const ownerKeyPair = generateKemSeedAndKeyPair();
  const localKeyPair = generateKemSeedAndKeyPair();
  const expectedRecipientFingerprints = [
    await toFingerprint(ownerKeyPair.publicKey),
    await toFingerprint(localKeyPair.publicKey),
  ].sort();
  const createContainerCalls: Array<{
    id: string;
    initialMetadataUpdateRecipientFingerprints: string[];
    parentId: string;
  }> = [];

  runtime.isAuthenticated = true;
  runtime.online = true;
  runtime.encapsulationKeyPair = localKeyPair;
  runtime.apiClient = {
    createContainer: async (
      id: string,
      parentId: string,
      initialMetadataUpdates,
    ) => {
      createContainerCalls.push({
        id,
        initialMetadataUpdateRecipientFingerprints: initialMetadataUpdates
          .flatMap((update) =>
            parseEnvelope(update.encryptedData).recipients.map(
              (recipient) => recipient.keyFingerprint,
            ),
          )
          .sort(),
        parentId,
      });
      return {
        id,
        metadataAccessEpoch: 1,
        metadataDocumentId: "metadata-document-2",
        metadataRecipientEncapsulationPublicKeys: [
          bytesToBase64(ownerKeyPair.publicKey),
          bytesToBase64(localKeyPair.publicKey),
        ],
        organizationId: "org-2",
        parentId,
      };
    },
    listContainers: async () => [
      {
        id: "shared-root-container",
        metadataAccessEpoch: 1,
        metadataDocumentId: "shared-root-metadata-document",
        metadataRecipientEncapsulationPublicKeys: [
          bytesToBase64(ownerKeyPair.publicKey),
          bytesToBase64(localKeyPair.publicKey),
        ],
        organizationId: "org-2",
        parentId: null,
      },
    ],
    shareContainer: async () => null,
    syncDocument: async () => null,
  };

  try {
    const store = createExplorerStore(runtime);
    store.updateRuntime(runtime);

    await waitForCondition(
      () =>
        store
          .getSnapshot()
          .nodes.some((node) => node.id === "shared-root-container"),
      "Explorer store did not hydrate the shared root container.",
    );

    const childNode = await store.createChild("shared-root-container", "Docs");
    if (!childNode) {
      throw new Error("Expected createChild to return a new container node.");
    }

    expect(createContainerCalls).toEqual([
      {
        id: childNode.id,
        initialMetadataUpdateRecipientFingerprints:
          expectedRecipientFingerprints,
        parentId: "shared-root-container",
      },
    ]);
  } finally {
    runtime.close();
  }
});

test("explorer store shares an authenticated container and enqueues a full metadata baseline", async () => {
  const runtime = await createSqlRuntime();
  const shareContainerCalls: Array<{
    accessLevel: "read" | "write" | "admin";
    containerId: string;
    subjectId: string;
    subjectType: "user" | "group" | "organization";
  }> = [];
  const syncCalls: Array<{
    accessEpoch: number;
    documentId: string;
    outgoingUpdateCount: number;
  }> = [];

  runtime.isAuthenticated = true;
  runtime.online = true;
  runtime.encapsulationKeyPair = generateKemSeedAndKeyPair();
  runtime.apiClient = {
    createContainer: async () => null,
    listContainers: async () => [],
    shareContainer: async (
      containerId: string,
      subjectType: "user" | "group" | "organization",
      subjectId: string,
      accessLevel: "read" | "write" | "admin",
    ) => {
      shareContainerCalls.push({
        accessLevel,
        containerId,
        subjectId,
        subjectType,
      });
      return {
        id: containerId,
        metadataAccessEpoch: 2,
        metadataDocumentId: "metadata-document-1",
        metadataRecipientEncapsulationPublicKeys: [],
      };
    },
    syncDocument: async (
      documentId,
      accessEpoch,
      _localVersionVector,
      updates,
    ) => {
      syncCalls.push({
        accessEpoch,
        documentId,
        outgoingUpdateCount: updates.length,
      });
      return {
        acceptedOutgoingUpdateIds: updates.map((update) => update.id),
        currentAccessEpoch: accessEpoch,
        documentId,
        recipientEncapsulationPublicKeys: [],
        updates: [],
      };
    },
  };
  let store: ReturnType<typeof createExplorerStore> | null = null;

  try {
    await ensureContainerTables(runtime.execSql);
    await saveContainer(runtime.execSql, {
      id: "root-container",
      organizationId: "org-1",
      parentId: null,
      metadataDocumentId: "root-metadata-document",
      name: "/",
      icon: null,
    });
    await saveContainer(runtime.execSql, {
      id: "child-container",
      organizationId: "org-1",
      parentId: "root-container",
      metadataDocumentId: "metadata-document-1",
      name: "Docs",
      icon: null,
    });

    const createdStore = createExplorerStore(runtime);
    store = createdStore;
    createdStore.updateRuntime(runtime);

    await waitForCondition(
      () => createdStore.getSnapshot().ready,
      "Explorer store did not become ready.",
    );

    const shared = await createdStore.shareWithUser(
      "child-container",
      "550e8400-e29b-41d4-a716-446655440000",
    );

    expect(shared).toBe(true);

    await waitForCondition(
      () =>
        syncCalls.some(
          (call) =>
            call.accessEpoch === 2 &&
            call.documentId === "metadata-document-1" &&
            call.outgoingUpdateCount === 1,
        ),
      "Explorer store did not sync shared metadata baseline.",
    );

    expect(shareContainerCalls).toEqual([
      {
        accessLevel: "write",
        containerId: "child-container",
        subjectId: "550e8400-e29b-41d4-a716-446655440000",
        subjectType: "user",
      },
    ]);
    expect(
      syncCalls.some(
        (call) =>
          call.accessEpoch === 2 &&
          call.documentId === "metadata-document-1" &&
          call.outgoingUpdateCount === 1,
      ),
    ).toBe(true);
  } finally {
    if (store) {
      runtime.dbStatus = "terminated";
      store.updateRuntime(runtime);
    }
    runtime.close();
  }
});

test("explorer store refreshes remote containers on demand after initialization", async () => {
  const runtime = await createSqlRuntime();
  let listContainersCalls = 0;

  runtime.isAuthenticated = true;
  runtime.online = true;
  runtime.encapsulationKeyPair = generateKemSeedAndKeyPair();
  runtime.apiClient = {
    createContainer: async () => null,
    listContainers: async () => {
      listContainersCalls += 1;

      if (listContainersCalls === 1) {
        return [];
      }

      return [
        {
          id: "shared-root-container",
          metadataAccessEpoch: 1,
          metadataDocumentId: "shared-root-metadata-document",
          metadataRecipientEncapsulationPublicKeys: [],
          organizationId: "org-2",
          parentId: null,
        },
      ];
    },
    shareContainer: async () => null,
    syncDocument: async () => null,
  };
  let store: ReturnType<typeof createExplorerStore> | null = null;

  try {
    const createdStore = createExplorerStore(runtime);
    store = createdStore;
    createdStore.updateRuntime(runtime);

    await waitForCondition(
      () => createdStore.getSnapshot().ready,
      "Explorer store did not become ready.",
    );

    expect(createdStore.getSnapshot().nodes).toEqual([]);

    const refreshed = await createdStore.refresh();

    expect(refreshed).toBe(true);

    await waitForCondition(
      () =>
        createdStore
          .getSnapshot()
          .nodes.some((node) => node.id === "shared-root-container"),
      "Explorer refresh did not hydrate shared remote root.",
    );

    expect(listContainersCalls).toBeGreaterThanOrEqual(2);
  } finally {
    if (store) {
      runtime.dbStatus = "terminated";
      store.updateRuntime(runtime);
    }
    runtime.close();
  }
});
