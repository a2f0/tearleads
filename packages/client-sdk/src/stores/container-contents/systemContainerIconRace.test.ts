import { expect, test } from "bun:test";
import { createMockApiClient } from "@tearleads/test-utils";
import type { BlobStore } from "../../data/blobContracts";
import {
  createContainerMetadataDocument,
  readContainerMetadataValue,
} from "../../data/containers/containerMetadataDocument";
import { defaultDocumentProjectorRegistry } from "../../data/documents/documentKinds";
import type { DomainScope } from "../../data/domainScope";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import type { ContainerContentsPersistence } from "../../workflows/container-contents/containerPersistence";
import type { ContainerState } from "../../workflows/container-contents/remoteHydration";
import { createContainerContentsStoreTestRuntime } from "./runtime.testFixtures";
import { createContainerContentsStoreState } from "./state";
import type { ContainerContentsStoreSyncAgent } from "./syncAgent";
import { applySystemContainerIcon } from "./systemContainerIcon";

async function remoteContainerState(input: {
  id: string;
  parentId: string | null;
}): Promise<ContainerState> {
  const metadataDocumentId = `${input.id}-metadata`;
  return {
    container: {
      effectiveAccessLevel: "admin",
      icon: null,
      id: input.id,
      metadataDocumentId,
      name: input.parentId === null ? "/" : "Contacts",
      organizationId: "organization-id",
      parentId: input.parentId,
      systemSlot: null,
    },
    doc: await createContainerMetadataDocument(input.id),
    record: {
      accessEpoch: 1,
      accessStateHash: `${input.id}-access-state`,
      contentKeyBundle: null,
      documentId: metadataDocumentId,
      documentKekTargets: null,
      documentManifestBundle: null,
      id: input.id,
      lastCommitLsn: null,
      metadataUpdates: "",
      snapshotEndVersion: "",
    },
  };
}

test("a superseded system icon is identity-guarded before enqueue", async () => {
  const root = await remoteContainerState({ id: "root", parentId: null });
  const system = await remoteContainerState({
    id: "remote-contacts",
    parentId: root.container.id,
  });
  const pendingUpdateIds = new Set(["other-pane-update"]);
  let deleteAllCalls = 0;
  let enqueueCalls = 0;
  const persistence = {
    ...({} as ContainerContentsPersistence),
    deletePendingUpdate: async (_execSql: ExecSql, id: string) => {
      pendingUpdateIds.delete(id);
    },
    deletePendingUpdates: async () => {
      deleteAllCalls += 1;
      pendingUpdateIds.clear();
    },
    enqueuePendingUpdate: async () => {
      enqueueCalls += 1;
      const id = "stale-icon-update";
      pendingUpdateIds.add(id);
      return id;
    },
  };
  const runtime = createContainerContentsStoreTestRuntime({
    apiClient: createMockApiClient(),
    auth: {
      isAuthenticated: true,
      organizationId: "organization-id",
      userId: "user-id",
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
      execSql: (async () => []) as ExecSql,
    },
    resolveTrustedUserIdentity: async () => null,
    state: {
      containerId: root.container.id,
      domainScope: {} as DomainScope,
      events: [],
      online: true,
    },
    util: {
      log: () => {},
      reportSecurityIncident: async () => undefined,
    },
  });
  const state = createContainerContentsStoreState(runtime, persistence);
  state.containersById.set(root.container.id, root);
  state.containersById.set(system.container.id, system);
  let syncRequests = 0;
  let capturedUpdateByteLength = 0;

  expect(
    await applySystemContainerIcon({
      containerState: system,
      icon: "contacts",
      persistIcon: async (_containerState, _icon, update) => {
        capturedUpdateByteLength = update.byteLength;
        return "identity-superseded";
      },
      state,
      syncAgent: {
        scheduleSync: () => {
          syncRequests += 1;
        },
      } as unknown as ContainerContentsStoreSyncAgent,
    }),
  ).toBe(false);
  expect([...pendingUpdateIds]).toEqual(["other-pane-update"]);
  expect(enqueueCalls).toBe(0);
  expect(capturedUpdateByteLength).toBeGreaterThan(0);
  expect(deleteAllCalls).toBe(0);
  expect(syncRequests).toBe(0);
  expect(readContainerMetadataValue(system.doc, "Contacts").icon).toBeNull();

  let current = true;
  expect(
    await applySystemContainerIcon({
      containerState: system,
      icon: "contacts",
      isCurrent: () => current,
      persistIcon: async () => {
        current = false;
        return "persisted";
      },
      state,
      syncAgent: {
        scheduleSync: () => {
          syncRequests += 1;
        },
      } as unknown as ContainerContentsStoreSyncAgent,
    }),
  ).toBe(false);
  expect(readContainerMetadataValue(system.doc, "Contacts").icon).toBeNull();
  expect(syncRequests).toBe(0);
});
