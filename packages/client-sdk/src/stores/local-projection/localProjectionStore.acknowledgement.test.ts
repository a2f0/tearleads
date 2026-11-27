import { expect, test } from "bun:test";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import { createContainerContentsTestRuntime } from "../../../test/helpers/workflows/containerContentsTestRuntime";
import type { DomainScope } from "../../data/shared/domainScope";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import type { ContainerContentsStore } from "../container-contents/types";
import { createLocalProjectionStore } from "./localProjectionStore";

function createRuntime(input: {
  connectionGeneration: number;
  domainScope: DomainScope;
  execSql: ExecSql;
}) {
  const runtime = createContainerContentsTestRuntime({
    apiClient: createMockApiClient(),
    domainScope: input.domainScope,
    encapsulationKeyPair: null,
    execSql: input.execSql,
  });
  return {
    ...runtime,
    state: {
      ...runtime.state,
      serverEventsConnectionGeneration: input.connectionGeneration,
    },
  };
}

/** A tree store whose readiness the test controls. */
function createTree(initiallyReady: boolean) {
  let ready = initiallyReady;
  let emit = () => {};
  const containerStore = {
    getSnapshot: () => ({ nodes: [], ready }),
    subscribe: (listener: () => void) => {
      emit = listener;
      return () => {
        emit = () => {};
      };
    },
    updateRuntime: () => {},
  } as unknown as ContainerContentsStore;
  return {
    containerStore,
    becomeReady: () => {
      ready = true;
      emit();
    },
  };
}

test("each acknowledged connection raises connection-acknowledged once", async () => {
  const { close, execSql } = await createTestExecSql(
    "local-projection-acknowledged-signal-test",
  );
  const domainScope = {} as DomainScope;
  try {
    const runtime = (connectionGeneration: number) =>
      createRuntime({ connectionGeneration, domainScope, execSql });
    const store = createLocalProjectionStore({
      containerStore: createTree(true).containerStore,
      runtime: runtime(0),
    });
    const signals: string[] = [];
    store.onReconcileSignal((signal) => signals.push(signal.reason));

    store.updateRuntime(runtime(0));
    expect(signals).toEqual(["hydrated", "owed-discovery"]);

    // The first acknowledgement after a restart owes the catch-up too.
    store.updateRuntime(runtime(1));
    expect(signals).toEqual([
      "hydrated",
      "owed-discovery",
      "connection-acknowledged",
    ]);

    // The same generation again, as on any unrelated runtime change.
    store.updateRuntime(runtime(1));
    expect(signals).toEqual([
      "hydrated",
      "owed-discovery",
      "connection-acknowledged",
    ]);

    store.updateRuntime(runtime(2));
    expect(signals).toEqual([
      "hydrated",
      "owed-discovery",
      "connection-acknowledged",
      "connection-acknowledged",
    ]);
  } finally {
    close();
  }
});

test("an acknowledgement before tree readiness is latched until hydration", async () => {
  const { close, execSql } = await createTestExecSql(
    "local-projection-acknowledged-latched-test",
  );
  const domainScope = {} as DomainScope;
  try {
    const tree = createTree(false);
    const store = createLocalProjectionStore({
      containerStore: tree.containerStore,
      runtime: createRuntime({ connectionGeneration: 0, domainScope, execSql }),
    });
    const signals: string[] = [];
    store.onReconcileSignal((signal) => signals.push(signal.reason));

    store.updateRuntime(
      createRuntime({ connectionGeneration: 1, domainScope, execSql }),
    );
    // The listing needs the tree to know which lanes to list.
    expect(signals).toEqual([]);

    tree.becomeReady();
    expect(signals).toEqual(["hydrated", "connection-acknowledged"]);
  } finally {
    close();
  }
});

test("a projection opened after the acknowledgement still owes the catch-up", async () => {
  const { close, execSql } = await createTestExecSql(
    "local-projection-acknowledged-late-open-test",
  );
  const domainScope = {} as DomainScope;
  try {
    const runtime = createRuntime({
      connectionGeneration: 3,
      domainScope,
      execSql,
    });
    const store = createLocalProjectionStore({
      containerStore: createTree(true).containerStore,
      runtime,
    });
    const signals: string[] = [];
    store.onReconcileSignal((signal) => signals.push(signal.reason));

    store.updateRuntime(runtime);

    expect(signals).toEqual(["hydrated", "connection-acknowledged"]);
  } finally {
    close();
  }
});

test("the tree store learns of a connection before its catch-up is signalled", async () => {
  const { close, execSql } = await createTestExecSql(
    "local-projection-acknowledged-order-test",
  );
  const domainScope = {} as DomainScope;
  try {
    const calls: string[] = [];
    const tree = createTree(true);
    // The real tree store owes the new connection's crawl in this call. A
    // catch-up signalled first could read the previous connection's
    // complete crawl as this one's.
    tree.containerStore.updateRuntime = (runtime) => {
      calls.push(`tree:${runtime.state.serverEventsConnectionGeneration}`);
    };
    const runtime = (connectionGeneration: number) =>
      createRuntime({ connectionGeneration, domainScope, execSql });
    const store = createLocalProjectionStore({
      containerStore: tree.containerStore,
      runtime: runtime(0),
    });
    store.onReconcileSignal((signal) => calls.push(signal.reason));
    store.updateRuntime(runtime(0));
    calls.length = 0;

    store.updateRuntime(runtime(1));

    expect(calls).toEqual(["tree:1", "connection-acknowledged"]);
  } finally {
    close();
  }
});
