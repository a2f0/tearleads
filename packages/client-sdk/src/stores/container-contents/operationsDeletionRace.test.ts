import { expect, test } from "bun:test";
import { bytesToBase64 } from "@symcrypt/encoding";
import { exportAllUpdates } from "@symcrypt/loro";
import { createTestExecSql } from "@symcrypt/test-utils";
import {
  createContainerMetadataDocument,
  readContainerMetadataValue,
  writeContainerMetadataValue,
} from "../../data/containers/containerMetadataDocument";
import type { DomainScope } from "../../data/domainScope";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import {
  type ContainerContentsPersistence,
  defaultContainerContentsPersistence,
} from "../../workflows/container-contents/containerPersistence";
import type { ContainerState } from "../../workflows/container-contents/remoteHydration";
import { deleteContainer, moveContainer, renameContainer } from "./operations";
import { createContainerContentsTestRuntime } from "./runtime.testFixtures";
import { setContainerIcon } from "./setContainerIconOperation";
import {
  createContainerContentsStoreState,
  updateContainerContentsSnapshot,
} from "./state";
import type { ContainerContentsStoreSyncAgent } from "./syncAgent";

async function createState(input: {
  documentId: string | null;
  id: string;
  parentId: string | null;
}): Promise<ContainerState> {
  return {
    container: {
      effectiveAccessLevel: "admin",
      icon: null,
      id: input.id,
      metadataDocumentId: input.documentId,
      name: input.id,
      organizationId: "org-1",
      parentId: input.parentId,
      systemSlot: null,
    },
    doc: await createContainerMetadataDocument(input.id),
    record: {
      accessEpoch: 1,
      accessStateHash: input.documentId ? `access-${input.id}` : null,
      contentKeyBundle: null,
      documentId: input.documentId,
      documentKekTargets: null,
      documentManifestBundle: null,
      id: input.id,
      lastCommitLsn: null,
      metadataUpdates: "",
      snapshotEndVersion: "",
    },
  };
}

test.each([
  ["rename", false],
  ["icon", false],
  ["local move", false],
  ["remote move", true],
] as const)("%s returns null and removes stale state when a concurrent delete wins", async (operation, remote) => {
  const logs: string[] = [];
  const execSql = (async () => []) as ExecSql;
  const persistence: ContainerContentsPersistence = {
    ...defaultContainerContentsPersistence,
    loadContainerMetadataState: async () => null,
  };
  const state = createContainerContentsStoreState(
    createContainerContentsTestRuntime({
      domainScope: {} as DomainScope,
      execSql,
      log: (message) => logs.push(message),
    }),
    persistence,
  );
  const source = await createState({
    documentId: remote ? "remote-source" : null,
    id: "source",
    parentId: "old-parent",
  });
  const oldParent = await createState({
    documentId: "remote-old-parent",
    id: "old-parent",
    parentId: null,
  });
  const newParent = await createState({
    documentId: "remote-new-parent",
    id: "new-parent",
    parentId: null,
  });
  state.containersById.set(source.container.id, source);
  state.containersById.set(oldParent.container.id, oldParent);
  state.containersById.set(newParent.container.id, newParent);
  updateContainerContentsSnapshot(state);
  let syncRequests = 0;
  const syncAgent = {
    scheduleSync: () => {
      syncRequests += 1;
    },
  } as unknown as ContainerContentsStoreSyncAgent;

  const result =
    operation === "rename"
      ? await renameContainer(state, syncAgent, source.container.id, "After")
      : operation === "icon"
        ? await setContainerIcon(
            state,
            syncAgent,
            source.container.id,
            "folder-special",
          )
        : await moveContainer(
            state,
            syncAgent,
            source.container.id,
            newParent.container.id,
          );

  expect(result).toBeNull();
  expect(state.containersById.has(source.container.id)).toBe(false);
  expect(state.snapshot.nodes.map((node) => node.id)).not.toContain(
    source.container.id,
  );
  expect(syncRequests).toBe(0);
  expect(logs).toEqual([]);
});

test("a completed deletion forces a current local refresh after generation rollover", async () => {
  const execSql = (async () => []) as ExecSql;
  let current = true;
  const persistence: ContainerContentsPersistence = {
    ...defaultContainerContentsPersistence,
    deleteContainer: async () => {
      current = false;
    },
  };
  const state = createContainerContentsStoreState(
    createContainerContentsTestRuntime({
      domainScope: {} as DomainScope,
      execSql,
    }),
    persistence,
  );
  const parent = await createState({
    documentId: null,
    id: "parent",
    parentId: null,
  });
  const source = await createState({
    documentId: null,
    id: "source",
    parentId: parent.container.id,
  });
  state.containersById.set(parent.container.id, parent);
  state.containersById.set(source.container.id, source);
  updateContainerContentsSnapshot(state);
  let refreshes = 0;
  const syncAgent = {
    refreshLocalContainers: async () => {
      refreshes += 1;
    },
  } as unknown as ContainerContentsStoreSyncAgent;

  expect(
    await deleteContainer(state, syncAgent, source.container.id, () => current),
  ).toBeNull();
  expect(refreshes).toBe(1);
  expect(state.localContainersNeedRefresh).toBe(true);
  expect(state.containersById.get(source.container.id)).toBe(source);
});

test("move fails explicitly and refreshes authoritative state when metadata identity wins", async () => {
  const logs: string[] = [];
  const execSql = (async () => []) as ExecSql;
  const source = await createState({
    documentId: "metadata-old",
    id: "source",
    parentId: "old-parent",
  });
  const authoritativeContainer = {
    ...source.container,
    metadataDocumentId: "metadata-new",
    parentId: "authoritative-parent",
  };
  const authoritativeRecord = {
    ...source.record,
    accessEpoch: 2,
    accessStateHash: "access-new",
    documentId: "metadata-new",
  };
  const persistence: ContainerContentsPersistence = {
    ...defaultContainerContentsPersistence,
    loadContainerMetadataState: async () => ({
      container: authoritativeContainer,
      record: authoritativeRecord,
    }),
  };
  const state = createContainerContentsStoreState(
    createContainerContentsTestRuntime({
      domainScope: {} as DomainScope,
      execSql,
      log: (message) => logs.push(message),
    }),
    persistence,
  );
  const oldParent = await createState({
    documentId: "remote-old-parent",
    id: "old-parent",
    parentId: null,
  });
  const newParent = await createState({
    documentId: "remote-new-parent",
    id: "new-parent",
    parentId: null,
  });
  state.containersById.set(source.container.id, source);
  state.containersById.set(oldParent.container.id, oldParent);
  state.containersById.set(newParent.container.id, newParent);
  updateContainerContentsSnapshot(state);
  let syncRequests = 0;
  const syncAgent = {
    scheduleSync: () => {
      syncRequests += 1;
    },
  } as unknown as ContainerContentsStoreSyncAgent;

  const result = await moveContainer(
    state,
    syncAgent,
    source.container.id,
    newParent.container.id,
  );

  expect(result).toBeNull();
  expect(source.container).toEqual(authoritativeContainer);
  expect(source.record).toEqual(authoritativeRecord);
  expect(
    state.snapshot.nodes.find((node) => node.id === source.container.id)
      ?.parentId,
  ).toBe("authoritative-parent");
  expect(syncRequests).toBe(0);
  expect(logs).toEqual([]);
});

test.each([
  "rename",
  "icon",
] as const)("%s rolls back its detached edit when the structural generation expires", async (operation) => {
  const database = await createTestExecSql(
    `container-${operation}-generation-guard`,
  );
  try {
    const source = await createState({
      documentId: null,
      id: "source",
      parentId: "parent",
    });
    writeContainerMetadataValue(source.doc, {
      icon: null,
      name: "Before",
    });
    source.record.metadataUpdates = bytesToBase64(exportAllUpdates(source.doc));
    await defaultContainerContentsPersistence.ensureSchema(database.execSql);
    await defaultContainerContentsPersistence.saveContainer(
      database.execSql,
      source.container,
      source.record,
    );

    let current = true;
    const persistence: ContainerContentsPersistence = {
      ...defaultContainerContentsPersistence,
      commitMetadataMutation: async (...args) => {
        current = false;
        return defaultContainerContentsPersistence.commitMetadataMutation(
          ...args,
        );
      },
    };
    const state = createContainerContentsStoreState(
      createContainerContentsTestRuntime({
        domainScope: {} as DomainScope,
        execSql: database.execSql,
      }),
      persistence,
    );
    state.containersById.set(source.container.id, source);
    updateContainerContentsSnapshot(state);
    const syncAgent = {
      scheduleSync: () => {
        throw new Error("A stale metadata edit must not schedule sync");
      },
    } as unknown as ContainerContentsStoreSyncAgent;

    const result =
      operation === "rename"
        ? await renameContainer(
            state,
            syncAgent,
            source.container.id,
            "After",
            () => current,
          )
        : await setContainerIcon(
            state,
            syncAgent,
            source.container.id,
            "folder-special",
            () => current,
          );

    expect(result).toBeNull();
    expect(readContainerMetadataValue(source.doc, "source")).toEqual({
      icon: null,
      name: "Before",
    });
    expect(
      (
        await defaultContainerContentsPersistence.loadContainers(
          database.execSql,
        )
      )[0]?.container,
    ).toMatchObject({ icon: null, name: "source" });
    expect(
      await database.execSql("SELECT local_id FROM document_pending_updates"),
    ).toEqual([]);
  } finally {
    database.close();
  }
});
