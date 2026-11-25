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
    expect(signals).toEqual(["hydrated"]);

    // The first acknowledgement after a restart owes the catch-up too.
    store.updateRuntime(runtime(1));
    expect(signals).toEqual(["hydrated", "connection-acknowledged"]);

    // The same generation again, as on any unrelated runtime change.
    store.updateRuntime(runtime(1));
    expect(signals).toEqual(["hydrated", "connection-acknowledged"]);

    store.updateRuntime(runtime(2));
    expect(signals).toEqual([
      "hydrated",
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
