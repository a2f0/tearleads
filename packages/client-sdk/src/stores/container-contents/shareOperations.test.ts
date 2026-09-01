import { expect, test } from "bun:test";
import { createContainerMetadataDocument } from "../../data/containers/containerMetadataDocument";
import type { DomainScope } from "../../data/domainScope";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { defaultContainerContentsPersistence } from "../../workflows/container-contents/containerPersistence";
import type { ContainerState } from "../../workflows/container-contents/remoteHydration";
import { createContainerContentsTestRuntime } from "./runtime.testFixtures";
import { shareContainerUsing } from "./shareOperations";
import {
  createContainerContentsStoreState,
  updateContainerContentsSnapshot,
} from "./state";
import type { ContainerContentsStoreSyncAgent } from "./syncAgent";

async function createRemoteState(): Promise<ContainerState> {
  return {
    container: {
      effectiveAccessLevel: "admin",
      icon: null,
      id: "shared-container",
      metadataDocumentId: "metadata-old",
      name: "Shared",
      organizationId: "org-1",
      parentId: null,
      systemSlot: null,
    },
    doc: await createContainerMetadataDocument("shared-container"),
    record: {
      accessEpoch: 1,
      accessStateHash: "access-old",
      contentKeyBundle: null,
      documentId: "metadata-old",
      documentKekTargets: null,
      documentManifestBundle: null,
      id: "shared-container",
      lastCommitLsn: null,
      metadataUpdates: "",
      snapshotEndVersion: "",
    },
  };
}

function createSyncAgent(calls: { prime: number; sync: number }) {
  return {
    primeDocumentsForSharedSubtree: async () => {
      calls.prime += 1;
    },
    scheduleSync: () => {
      calls.sync += 1;
    },
  } as unknown as ContainerContentsStoreSyncAgent;
}

test("a share settlement removes only the exact state deleted durably", async () => {
  const source = await createRemoteState();
  const state = createContainerContentsStoreState(
    createContainerContentsTestRuntime({
      domainScope: {} as DomainScope,
      execSql: (async () => []) as ExecSql,
    }),
    defaultContainerContentsPersistence,
  );
  state.containersById.set(source.container.id, source);
  updateContainerContentsSnapshot(state);
  const calls = { prime: 0, sync: 0 };

  const result = await shareContainerUsing(
    state,
    createSyncAgent(calls),
    source.container.id,
    async () => ({ status: "missing" }),
    "unexpected share",
  );

  expect(result).toBeNull();
  expect(state.containersById.has(source.container.id)).toBe(false);
  expect(state.snapshot.nodes).toEqual([]);
  expect(calls).toEqual({ prime: 0, sync: 0 });
});

test("a share settlement publishes a replacement identity without success effects", async () => {
  const source = await createRemoteState();
  const state = createContainerContentsStoreState(
    createContainerContentsTestRuntime({
      domainScope: {} as DomainScope,
      execSql: (async () => []) as ExecSql,
    }),
    defaultContainerContentsPersistence,
  );
  state.containersById.set(source.container.id, source);
  updateContainerContentsSnapshot(state);
  const calls = { prime: 0, sync: 0 };
  const authoritativeContainer = {
    ...source.container,
    metadataDocumentId: "metadata-new",
    name: "Authoritative",
  };
  const authoritativeRecord = {
    ...source.record,
    accessEpoch: 2,
    accessStateHash: "access-new",
    documentId: "metadata-new",
  };

  const result = await shareContainerUsing(
    state,
    createSyncAgent(calls),
    source.container.id,
    async () => ({
      container: authoritativeContainer,
      record: authoritativeRecord,
      status: "identity-superseded",
    }),
    "unexpected share",
  );

  expect(result).toBeNull();
  expect(source.container).toEqual(authoritativeContainer);
  expect(source.record).toEqual(authoritativeRecord);
  expect(state.snapshot.nodes[0]).toMatchObject({
    metadataDocumentId: "metadata-new",
    name: "Authoritative",
  });
  expect(calls).toEqual({ prime: 0, sync: 0 });
});

test("shared-subtree priming receives the active structural guard", async () => {
  const source = await createRemoteState();
  const state = createContainerContentsStoreState(
    createContainerContentsTestRuntime({
      domainScope: {} as DomainScope,
      execSql: (async () => []) as ExecSql,
    }),
    defaultContainerContentsPersistence,
  );
  state.containersById.set(source.container.id, source);
  updateContainerContentsSnapshot(state);
  let current = true;
  const isCurrent = () => current;
  let receivedGuard: (() => boolean) | undefined;
  let syncRequests = 0;
  const syncAgent = {
    primeDocumentsForSharedSubtree: async (
      _containerId: string,
      guard?: (() => boolean) | undefined,
    ) => {
      receivedGuard = guard;
      current = false;
    },
    scheduleSync: () => {
      syncRequests += 1;
    },
  } as unknown as ContainerContentsStoreSyncAgent;

  expect(
    await shareContainerUsing(
      state,
      syncAgent,
      source.container.id,
      async () => ({
        container: source.container,
        record: source.record,
        status: "persisted",
      }),
      "shared",
      isCurrent,
    ),
  ).toBeNull();
  expect(receivedGuard).toBe(isCurrent);
  expect(receivedGuard?.()).toBe(false);
  expect(syncRequests).toBe(0);
});
