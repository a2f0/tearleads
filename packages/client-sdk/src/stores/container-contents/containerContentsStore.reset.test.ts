import { expect, test } from "bun:test";
import type { BlobStore } from "../../data/blobContracts";
import { defaultDocumentProjectorRegistry } from "../../data/documents/documentKinds";
import { createDomainScope } from "../../data/domainScope";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { defaultContainerContentsPersistence } from "../../workflows/container-contents/containerPersistence";
import { createContainerContentsStoreTestRuntime } from "./runtime.testFixtures";
import {
  createContainerContentsStoreState,
  updateContainerContentsStoreRuntime,
} from "./state";
import type { ContainerContentsStoreSyncAgent } from "./syncAgent";

function createRuntime(input: {
  dbStatus: "idle" | "ready";
}): ReturnType<typeof createContainerContentsStoreTestRuntime> {
  return createContainerContentsStoreTestRuntime({
    apiClient: {} as Parameters<
      typeof createContainerContentsStoreTestRuntime
    >[0]["apiClient"],
    auth: {
      isAuthenticated: true,
      organizationId: "org-1",
      userId: "user-1",
    },
    crypto: {
      encapsulationKeyPair: null,
      signingFingerprint: "signing-fingerprint-1",
      signingKeyPair: null,
    },
    infra: {
      blobStore: {} as BlobStore,
      dbStatus: input.dbStatus,
      documentProjectors: defaultDocumentProjectorRegistry,
      execSql: (async () => []) as ExecSql,
    },
    resolveTrustedUserIdentity: async () => null,
    state: {
      containerId: null,
      domainScope: createDomainScope(),
      events: [],
      online: true,
    },
    util: {
      log: () => {},
    },
  });
}

test("database loss reset clears accepted-echo suppression state", () => {
  const state = createContainerContentsStoreState(
    createRuntime({ dbStatus: "ready" }),
    defaultContainerContentsPersistence,
  );
  const unusedSyncAgent = {} as ContainerContentsStoreSyncAgent;

  // Simulate a store that accepted local metadata updates whose remote echo
  // has not arrived yet, plus a pending sync signal.
  state.initialized = true;
  state.locallyAcceptedMetadataUpdateIds.add("update-1");
  state.metadataDocumentIdsNeedingSync.add("metadata-doc-1");
  state.metadataSyncSignalSeqById.set("metadata-doc-1", 3);

  updateContainerContentsStoreRuntime(
    state,
    createRuntime({ dbStatus: "idle" }),
    unusedSyncAgent,
  );

  // After a database loss the tree rehydrates from remote; retained accepted
  // ids would suppress the next matching remote update signal.
  expect(state.initialized).toBe(false);
  expect(state.locallyAcceptedMetadataUpdateIds.size).toBe(0);
  expect(state.metadataDocumentIdsNeedingSync.size).toBe(0);
  expect(state.metadataSyncSignalSeqById.size).toBe(0);
});
