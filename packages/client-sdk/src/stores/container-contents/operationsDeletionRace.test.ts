import { expect, test } from "bun:test";
import { createContainerMetadataDocument } from "../../data/containers/containerMetadataDocument";
import type { DomainScope } from "../../data/domainScope";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import {
  type ContainerContentsPersistence,
  defaultContainerContentsPersistence,
} from "../../workflows/container-contents/containerPersistence";
import type { ContainerState } from "../../workflows/container-contents/remoteHydration";
import { moveContainer, renameContainer } from "./operations";
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
