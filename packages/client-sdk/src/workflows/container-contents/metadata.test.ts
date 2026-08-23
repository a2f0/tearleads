import { expect, test } from "bun:test";
import {
  createContainerMetadataDocument,
  readContainerMetadataValue,
  writeContainerMetadataValue,
} from "../../data/containers/containerMetadataDocument";
import type {
  ContainerContentsPersistence,
  ContainerMetadataRecord as ContainerDocumentRecord,
} from "../../data/persistence/container-contents/containerContentsPersistence";
import type { ContainerRecord } from "../../data/persistence/containers/containerPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import {
  cleanupContainerMetadataRegistrationsOnFailure,
  hasContainerMetadataDocumentUpdateEvent,
  listContainerMetadataDocumentUpdateIds,
  persistContainerMetadataStateFromRuntime,
  preRegisterMaterializedContainerMetadataUpdateIds,
  renameContainerMetadataStateFromRuntime,
  settleContainerMetadataOutgoingPass,
  syncContainerMetadataState,
} from "./metadata";
import {
  createContainerContentsPersistence,
  createContainerRecord,
  createDocumentRecord,
  metadataTestExecSql as execSql,
} from "./metadata.testFixtures";

const runtime = { infra: { execSql } };

type PendingUpdateInput = Parameters<
  ContainerContentsPersistence["enqueuePendingUpdate"]
>[1];

test("persistContainerMetadataStateFromRuntime uses the runtime executor", async () => {
  const container = createContainerRecord({
    id: "container-1",
    parentId: null,
  });
  const doc = await createContainerMetadataDocument(container.id);
  writeContainerMetadataValue(doc, {
    icon: "folder",
    name: "Runtime container",
  });
  const record = createDocumentRecord({ id: container.id });
  const savedContainers: Array<{
    container: ContainerRecord;
    execSql: ExecSql;
    record: ContainerDocumentRecord | null;
  }> = [];

  const persisted = await persistContainerMetadataStateFromRuntime({
    metadataState: { container, doc, record },
    persistence: createContainerContentsPersistence({ savedContainers }),
    runtime,
  });

  expect(savedContainers).toEqual([
    {
      container: persisted.container,
      execSql,
      record: persisted.record,
    },
  ]);
  expect(persisted.container).toMatchObject({
    icon: "folder",
    name: "Runtime container",
  });
});

test("renameContainerMetadataStateFromRuntime queues metadata update with the runtime executor", async () => {
  const container = createContainerRecord({
    id: "container-2",
    parentId: "parent-1",
  });
  const doc = await createContainerMetadataDocument(container.id);
  writeContainerMetadataValue(doc, {
    icon: "briefcase",
    name: "Old name",
  });
  const record = createDocumentRecord({ id: container.id });
  const pendingUpdates: Array<{
    execSql: ExecSql;
    input: PendingUpdateInput;
  }> = [];
  const savedContainers: Array<{
    container: ContainerRecord;
    execSql: ExecSql;
    record: ContainerDocumentRecord | null;
  }> = [];

  const renamed = await renameContainerMetadataStateFromRuntime({
    metadataState: { container, doc, record },
    name: "New name",
    persistence: createContainerContentsPersistence({
      pendingUpdates,
      savedContainers,
    }),
    runtime,
  });

  expect(renamed?.container.name).toBe("New name");
  expect(readContainerMetadataValue(doc, "Stored container")).toMatchObject({
    icon: "briefcase",
    name: "New name",
  });
  expect(pendingUpdates).toHaveLength(1);
  expect(pendingUpdates[0]?.execSql).toBe(execSql);
  expect(pendingUpdates[0]?.input.containerId).toBe(container.id);
  expect(savedContainers).toHaveLength(1);
  expect(savedContainers[0]?.execSql).toBe(execSql);
});

test("hasContainerMetadataDocumentUpdateEvent detects known metadata document updates", () => {
  const metadataState = {
    record: createDocumentRecord({
      documentId: "metadata-document-1",
      id: "container-1",
    }),
  };

  expect(
    listContainerMetadataDocumentUpdateIds(
      [
        {
          documentId: "metadata-document-1",
          id: "event-1",
          type: "document_update_created",
        },
      ],
      [metadataState],
    ),
  ).toEqual(["metadata-document-1"]);
  expect(
    hasContainerMetadataDocumentUpdateEvent(
      [
        {
          documentId: "metadata-document-1",
          id: "event-1",
          type: "document_update_created",
        },
      ],
      [metadataState],
    ),
  ).toBe(true);
  expect(
    hasContainerMetadataDocumentUpdateEvent(
      [
        {
          documentId: "other-document",
          id: "event-2",
          type: "document_update_created",
        },
      ],
      [metadataState],
    ),
  ).toBe(false);
  expect(
    hasContainerMetadataDocumentUpdateEvent(
      [
        {
          documentId: "metadata-document-1",
          id: "event-3",
          type: "other_event",
        },
      ],
      [metadataState],
    ),
  ).toBe(false);
});

test("listContainerMetadataDocumentUpdateIds suppresses the author's own metadata echo", () => {
  const metadataState = {
    record: createDocumentRecord({
      documentId: "metadata-document-1",
      id: "container-1",
    }),
  };

  // A self-echo: every updateId was pre-registered by this client's own send.
  // It is consumed (ids removed) and does not arm a forced read-sync.
  const registry = new Set(["own-update-a", "own-update-b"]);
  expect(
    listContainerMetadataDocumentUpdateIds(
      [
        {
          documentId: "metadata-document-1",
          id: "event-1",
          type: "document_update_created",
          updateIds: ["own-update-a", "own-update-b"],
        },
      ],
      [metadataState],
      registry,
    ),
  ).toEqual([]);
  expect(registry.size).toBe(0);

  // A genuine peer update carries an unknown id: it still forces the sync, and
  // any of our own ids riding alongside it are still consumed.
  const mixedRegistry = new Set(["own-update-c"]);
  expect(
    listContainerMetadataDocumentUpdateIds(
      [
        {
          documentId: "metadata-document-1",
          id: "event-2",
          type: "document_update_created",
          updateIds: ["own-update-c", "peer-update"],
        },
      ],
      [metadataState],
      mixedRegistry,
    ),
  ).toEqual(["metadata-document-1"]);
  expect(mixedRegistry.has("own-update-c")).toBe(false);

  // An event with no updateIds stays a lossy hint and still forces the sync.
  expect(
    listContainerMetadataDocumentUpdateIds(
      [
        {
          documentId: "metadata-document-1",
          id: "event-3",
          type: "document_update_created",
        },
      ],
      [metadataState],
      new Set(["unrelated"]),
    ),
  ).toEqual(["metadata-document-1"]);
});

test("metadata sync pre-registers only exact materialized batches", () => {
  const registry = new Set<string>();
  const registeredUpdateIds: string[] = [];

  preRegisterMaterializedContainerMetadataUpdateIds(
    registry,
    registeredUpdateIds,
    ["synthetic-recovery", "bounded-update"],
  );
  preRegisterMaterializedContainerMetadataUpdateIds(
    registry,
    registeredUpdateIds,
    ["bounded-update"],
  );

  expect(registeredUpdateIds).toEqual(["synthetic-recovery", "bounded-update"]);
  expect([...registry]).toEqual(registeredUpdateIds);
});

test("failed metadata recovery attempts discard synthetic registrations", async () => {
  const registry = new Set<string>();

  for (const updateId of ["synthetic-recovery-1", "synthetic-recovery-2"]) {
    const sentUpdateIds: string[] = [];
    const result = await cleanupContainerMetadataRegistrationsOnFailure(
      registry,
      sentUpdateIds,
      async () => {
        preRegisterMaterializedContainerMetadataUpdateIds(
          registry,
          sentUpdateIds,
          [updateId],
        );
        return null;
      },
    );
    expect(result).toBeNull();
    expect(registry.size).toBe(0);
  }

  const sentUpdateIds: string[] = [];
  await expect(
    cleanupContainerMetadataRegistrationsOnFailure(
      registry,
      sentUpdateIds,
      async () => {
        preRegisterMaterializedContainerMetadataUpdateIds(
          registry,
          sentUpdateIds,
          ["synthetic-recovery-error"],
        );
        throw new Error("metadata sync failed");
      },
    ),
  ).rejects.toThrow("metadata sync failed");
  expect(registry.size).toBe(0);
});

test("hasContainerMetadataDocumentUpdateEvent does not consume the caller's registry", () => {
  const metadataState = {
    record: createDocumentRecord({
      documentId: "metadata-document-1",
      id: "container-1",
    }),
  };
  const registry = new Set(["own-update-a"]);

  // The predicate reports "no remote update" for a pure self-echo...
  expect(
    hasContainerMetadataDocumentUpdateEvent(
      [
        {
          documentId: "metadata-document-1",
          id: "event-1",
          type: "document_update_created",
          updateIds: ["own-update-a"],
        },
      ],
      [metadataState],
      registry,
    ),
  ).toBe(false);
  // ...but must NOT consume the id, so the later real list pass still classifies
  // the echo as self-authored instead of arming a redundant sync.
  expect(registry.has("own-update-a")).toBe(true);
  expect(
    listContainerMetadataDocumentUpdateIds(
      [
        {
          documentId: "metadata-document-1",
          id: "event-1",
          type: "document_update_created",
          updateIds: ["own-update-a"],
        },
      ],
      [metadataState],
      registry,
    ),
  ).toEqual([]);
  expect(registry.size).toBe(0);
});

test("syncContainerMetadataState skips clean metadata with current read state", async () => {
  let listPendingUpdateCalls = 0;
  let writerProjectionCalls = 0;
  const container = createContainerRecord({
    id: "container-3",
    metadataDocumentId: "metadata-document-3",
    parentId: null,
  });
  const doc = await createContainerMetadataDocument(container.id);
  const record = createDocumentRecord({
    contentKeyBundle: "content-key-bundle",
    documentId: "metadata-document-3",
    documentKekTargets: "document-kek-targets",
    documentManifestBundle: "document-manifest-bundle",
    id: container.id,
    lastCommitLsn: "0/1",
  });
  const persistence = createContainerContentsPersistence({});

  const synced = await syncContainerMetadataState({
    metadataState: { container, doc, record },
    persistence: {
      ...persistence,
      async rekeyPendingUpdate() {
        return null;
      },
      async listPendingUpdates() {
        listPendingUpdateCalls += 1;
        return [];
      },
    },
    resolveProjectionUserKey: async () => {
      throw new Error("resolveProjectionUserKey should not be called.");
    },
    runtime: {
      apiClient: {
        getDocumentWriterProjection: async () => {
          writerProjectionCalls += 1;
          throw new Error("metadata writer projection should not be loaded.");
        },
      },
      auth: {
        deviceId: "device-1",
        organizationId: "org-1",
        userId: "user-1",
      },
      crypto: {
        encapsulationKeyPair: null,
        signingKeyPair: null,
        signingFingerprint: null,
      },
      infra: { execSql },
      state: {
        containerId: null,
        domainScope: {},
        events: [],
        online: true,
      },
      util: {
        log: () => undefined,
      },
    } as never,
    targetSecretKey: new Uint8Array(),
  });

  expect(synced).toBeNull();
  expect(listPendingUpdateCalls).toBe(1);
  expect(writerProjectionCalls).toBe(0);
});

test("metadata sync re-arms when a recovery baseline displaces queued edits", () => {
  const metadataState = {
    container: createContainerRecord({ id: "container-4", parentId: null }),
    doc: {} as never,
    record: createDocumentRecord({ id: "container-4" }),
  };

  expect(
    settleContainerMetadataOutgoingPass(metadataState, {
      outgoingUpdateCount: 2,
      synced: {
        rekeyedPendingUpdateIds: [],
        settledPendingUpdateIds: [],
        acceptedRecoveryBaseline: true,
      } as never,
    }),
  ).toBe(true);
});

test("metadata sync re-arms an incomplete paginated pull", () => {
  const metadataState = {
    container: createContainerRecord({ id: "container-5", parentId: null }),
    doc: {} as never,
    record: createDocumentRecord({ id: "container-5" }),
  };

  expect(
    settleContainerMetadataOutgoingPass(metadataState, {
      outgoingUpdateCount: 0,
      synced: {
        acceptedRecoveryBaseline: false,
        exhaustedPendingUpdateCount: 0,
        hasIncompletePull: true,
        rekeyedPendingUpdateIds: [],
        settledPendingUpdateIds: [],
      } as never,
    }),
  ).toBe(true);
});

test("a completed metadata cursor re-arms its queued writes", () => {
  const metadataState = {
    container: createContainerRecord({ id: "container-6", parentId: null }),
    doc: {} as never,
    record: createDocumentRecord({ id: "container-6" }),
  };

  expect(
    settleContainerMetadataOutgoingPass(metadataState, {
      outgoingUpdateCount: 1,
      synced: {
        acceptedRecoveryBaseline: false,
        exhaustedPendingUpdateCount: 0,
        hasDeferredPendingUpdates: true,
        hasIncompletePull: false,
        rekeyedPendingUpdateIds: [],
        settledPendingUpdateIds: [],
      } as never,
    }),
  ).toBe(true);
});

test("hasContainerMetadataDocumentUpdateEvent ignores containers without metadata document ids", () => {
  const metadataState = {
    record: createDocumentRecord({
      id: "container-1",
    }),
  };

  expect(
    hasContainerMetadataDocumentUpdateEvent(
      [
        {
          documentId: "metadata-document-1",
          id: "event-1",
          type: "document_update_created",
        },
      ],
      [metadataState],
    ),
  ).toBe(false);
});
