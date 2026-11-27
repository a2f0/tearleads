import { expect, test } from "bun:test";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import { createContainerContentsTestRuntime } from "../../../test/helpers/workflows/containerContentsTestRuntime";
import type { DomainScope } from "../../data/shared/domainScope";
import type { ContainerContentsStoreRuntime } from "../container-contents/syncAgent";
import type {
  ContainerContentsStore,
  ContainerNode,
} from "../container-contents/types";
import { createLocalProjectionStore } from "./localProjectionStore";

const KEY_PAIR = {
  publicKey: Uint8Array.from([1]),
  secretKey: Uint8Array.from([2]),
} as ContainerContentsStoreRuntime["crypto"]["encapsulationKeyPair"];

function node(id: string): ContainerNode {
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

interface Connection {
  readonly generation?: number;
  readonly keyPair?: boolean;
  readonly pendingAttempt?: number | undefined;
}

/**
 * A hydrated projection over a tree the test grows. Sync prerequisites are
 * regained when the key pair arrives.
 */
async function openProjection(name: string) {
  const { close, execSql } = await createTestExecSql(name);
  const domainScope = {} as DomainScope;
  let nodes = [node("root")];
  let emitTree = () => {};
  const containerStore = {
    getSnapshot: () => ({ nodes, ready: true }),
    subscribe: (listener: () => void) => {
      emitTree = listener;
      return () => undefined;
    },
    updateRuntime: () => {},
  } as unknown as ContainerContentsStore;
  const runtime = (connection: Connection) => {
    const value = createContainerContentsTestRuntime({
      apiClient: createMockApiClient(),
      domainScope,
      encapsulationKeyPair: connection.keyPair ? KEY_PAIR : null,
      execSql,
    });
    return {
      ...value,
      state: {
        ...value.state,
        serverEventsConnectionGeneration: connection.generation ?? 0,
        serverEventsPendingConnectAttempt: connection.pendingAttempt,
      },
    };
  };
  const initial = runtime({});
  const store = createLocalProjectionStore({
    containerStore,
    runtime: initial,
  });
  const signals: string[] = [];
  store.onReconcileSignal((signal) => {
    if (signal.reason !== "owed-discovery") signals.push(signal.reason);
  });
  store.updateRuntime(initial);
  signals.length = 0;
  const growTree = (id: string) => {
    nodes = [...nodes, node(id)];
    emitTree();
  };
  return { close, growTree, runtime, signals, store };
}

test("a regain while a connect attempt is pending holds its backfill for the acknowledgement's catch-up", async () => {
  const { close, runtime, signals, store } = await openProjection(
    "idle-backfill-acknowledged",
  );
  try {
    store.updateRuntime(runtime({ keyPair: true, pendingAttempt: 1 }));
    expect(signals).toEqual(["prerequisites-regained"]);
    store.updateRuntime(runtime({ keyPair: true, pendingAttempt: 1 }));
    expect(signals).toEqual(["prerequisites-regained"]);

    // The catch-up is requested first, so it takes the queued lanes over.
    store.updateRuntime(runtime({ generation: 1, keyPair: true }));
    expect(signals).toEqual([
      "prerequisites-regained",
      "connection-acknowledged",
      "idle-backfill",
    ]);
  } finally {
    close();
  }
});

test.each([
  ["ends", undefined],
  ["is replaced by a retry", 2],
])(
  "a held backfill is raised once its attempt %s unacknowledged",
  async (_name, next) => {
    const { close, runtime, signals, store } = await openProjection(
      "idle-backfill-unacknowledged",
    );
    try {
      store.updateRuntime(runtime({ keyPair: true, pendingAttempt: 1 }));
      store.updateRuntime(runtime({ keyPair: true, pendingAttempt: next }));
      expect(signals).toEqual(["prerequisites-regained", "idle-backfill"]);
      // A retry does not hold it again.
      store.updateRuntime(runtime({ keyPair: true }));
      expect(signals).toEqual(["prerequisites-regained", "idle-backfill"]);
    } finally {
      close();
    }
  },
);

test("the tree growing while a backfill is held is queued by that backfill", async () => {
  const { close, growTree, runtime, signals, store } = await openProjection(
    "idle-backfill-tree-growth",
  );
  try {
    store.updateRuntime(runtime({ keyPair: true, pendingAttempt: 1 }));
    growTree("granted");
    expect(signals).toEqual(["prerequisites-regained"]);

    store.updateRuntime(runtime({ keyPair: true }));
    expect(signals).toEqual(["prerequisites-regained", "idle-backfill"]);
    growTree("granted-later");
    expect(signals).toEqual([
      "prerequisites-regained",
      "idle-backfill",
      "remote-containers-added",
    ]);
  } finally {
    close();
  }
});
