import { expect, test } from "bun:test";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import type { BlobStore } from "../../data/blobContracts";
import { defaultDocumentProjectorRegistry } from "../../data/documents/documentKinds";
import type { DomainScope } from "../../data/domainScope";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { createContainerContentsStoreTestRuntime } from "../container-contents/runtime.testFixtures";
import type { ContainerContentsStoreRuntime } from "../container-contents/syncAgent";
import type {
  ContainerContentsStore,
  ContainerNode,
} from "../container-contents/types";
import { createLocalProjectionStore } from "./localProjectionStore";

function createRuntime(input: {
  domainScope: DomainScope;
  encapsulationKeyPair?: ContainerContentsStoreRuntime["crypto"]["encapsulationKeyPair"];
  execSql: ExecSql;
}): ReturnType<typeof createContainerContentsStoreTestRuntime> {
  return createContainerContentsStoreTestRuntime({
    apiClient: createMockApiClient(),
    auth: {
      isAuthenticated: true,
      organizationId: "org-1",
      userId: "user-1",
    },
    crypto: {
      encapsulationKeyPair: input.encapsulationKeyPair ?? null,
      signingFingerprint: null,
      signingKeyPair: null,
    },
    infra: {
      blobStore: {} as BlobStore,
      dbStatus: "ready",
      documentProjectors: defaultDocumentProjectorRegistry,
      execSql: input.execSql,
    },
    resolveTrustedUserIdentity: async () => null,
    state: {
      containerId: null,
      domainScope: input.domainScope,
      events: [],
      online: true,
    },
    util: {
      log: () => {},
    },
  });
}

const cachedRoot: ContainerNode = {
  effectiveAccessLevel: "admin",
  id: "cached-root",
  kind: "container",
  metadataDocumentId: "cached-root-metadata",
  name: "cached-root",
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

test("regaining the encapsulation key pair raises prerequisites-regained", async () => {
  const { close, execSql } = await createTestExecSql(
    "local-projection-key-pair-regained-signal-test",
  );
  const domainScope = {} as DomainScope;

  try {
    const withoutKeyPair = createRuntime({ domainScope, execSql });
    const containerStore = {
      getSnapshot: () => ({ nodes: [cachedRoot], ready: true }),
      subscribe: () => () => {},
      updateRuntime: () => {},
    } as unknown as ContainerContentsStore;
    const store = createLocalProjectionStore({
      containerStore,
      runtime: withoutKeyPair,
    });
    const signals: string[] = [];
    store.onReconcileSignal((signal) => {
      signals.push(signal.reason);
    });

    store.updateRuntime(withoutKeyPair);
    expect(signals).toEqual(["hydrated"]);

    // Unlocking the local keyring loads the key pair without an auth or
    // online edge — e.g. a restored session whose keys arrive after startup.
    // Remote reconciliation only became possible now, so the store must
    // signal it, exactly as the sync coordinator and container store treat
    // the same transition via didRegainSyncPrerequisites.
    const withKeyPair = createRuntime({
      domainScope,
      encapsulationKeyPair: {
        publicKey: Uint8Array.from([1]),
        secretKey: Uint8Array.from([2]),
      } as ContainerContentsStoreRuntime["crypto"]["encapsulationKeyPair"],
      execSql,
    });
    store.updateRuntime(withKeyPair);

    expect(signals).toEqual(["hydrated", "prerequisites-regained"]);
  } finally {
    close();
  }
});
