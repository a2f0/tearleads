import { expect, test } from "bun:test";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import type { DomainScope } from "../../data/domainScope";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { createContainerContentsTestRuntime } from "../container-contents/runtime.testFixtures";
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
}): ReturnType<typeof createContainerContentsTestRuntime> {
  return createContainerContentsTestRuntime({
    apiClient: createMockApiClient(),
    domainScope: input.domainScope,
    encapsulationKeyPair: input.encapsulationKeyPair ?? null,
    execSql: input.execSql,
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

test("a prerequisite regain before tree readiness is latched until hydration", async () => {
  const { close, execSql } = await createTestExecSql(
    "local-projection-key-pair-latched-signal-test",
  );
  const domainScope = {} as DomainScope;

  try {
    let ready = false;
    let nodes: ContainerNode[] = [];
    let emitContainerStore = () => {};
    const containerStore = {
      getSnapshot: () => ({ nodes, ready }),
      subscribe: (listener: () => void) => {
        emitContainerStore = listener;
        return () => {
          emitContainerStore = () => {};
        };
      },
      updateRuntime: () => {},
    } as unknown as ContainerContentsStore;

    const withoutKeyPair = createRuntime({ domainScope, execSql });
    const store = createLocalProjectionStore({
      containerStore,
      runtime: withoutKeyPair,
    });
    const signals: string[] = [];
    const containerIdsAtRegain: string[][] = [];
    store.onReconcileSignal((signal) => {
      signals.push(signal.reason);
      if (signal.reason === "prerequisites-regained") {
        // The backfill this signal triggers enumerates containers from the
        // snapshot synchronously; it must already see the hydrated tree.
        containerIdsAtRegain.push(
          store.getSnapshot().containers.map((node) => node.id),
        );
      }
    });

    // The key pair arrives while the container tree is still loading. The
    // regain must not be dropped: its reset-and-backfill runs after hydration.
    store.updateRuntime(withoutKeyPair);
    store.updateRuntime(
      createRuntime({
        domainScope,
        encapsulationKeyPair: {
          publicKey: Uint8Array.from([1]),
          secretKey: Uint8Array.from([2]),
        } as ContainerContentsStoreRuntime["crypto"]["encapsulationKeyPair"],
        execSql,
      }),
    );
    expect(signals).toEqual([]);

    ready = true;
    nodes = [cachedRoot];
    emitContainerStore();

    expect(signals).toEqual(["hydrated", "prerequisites-regained"]);
    expect(containerIdsAtRegain).toEqual([["cached-root"]]);
  } finally {
    close();
  }
});
