import { expect, test } from "bun:test";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import { createContainerContentsTestRuntime } from "../../../test/helpers/workflows/containerContentsTestRuntime";
import type { DomainScope } from "../../data/shared/domainScope";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import type { ContainerContentsStore } from "../container-contents/types";
import { createLocalProjectionStore } from "./localProjectionStore";

interface Connection {
  readonly generation: number;
  readonly pendingAttempt?: number | undefined;
}

function createRuntime(
  domainScope: DomainScope,
  execSql: ExecSql,
  connection: Connection,
) {
  const runtime = createContainerContentsTestRuntime({
    apiClient: createMockApiClient(),
    domainScope,
    encapsulationKeyPair: null,
    execSql,
  });
  return {
    ...runtime,
    state: {
      ...runtime.state,
      serverEventsConnectionGeneration: connection.generation,
      serverEventsPendingConnectAttempt: connection.pendingAttempt,
    },
  };
}

const readyTree = {
  getSnapshot: () => ({ nodes: [], ready: true }),
  subscribe: () => () => {},
  updateRuntime: () => {},
} as unknown as ContainerContentsStore;

/** A projection over a ready tree, with the signals it has raised. */
async function openProjection(name: string, connection: Connection) {
  const { close, execSql } = await createTestExecSql(name);
  const domainScope = {} as DomainScope;
  const runtime = (next: Connection) =>
    createRuntime(domainScope, execSql, next);
  const store = createLocalProjectionStore({
    containerStore: readyTree,
    runtime: runtime(connection),
  });
  const signals: string[] = [];
  store.onReconcileSignal((signal) => signals.push(signal.reason));
  return {
    close,
    signals,
    update: (next: Connection) => store.updateRuntime(runtime(next)),
  };
}

test("a start with no connect attempt resumes the owed lanes itself", async () => {
  const projection = await openProjection("owed-resume-no-attempt", {
    generation: 0,
  });
  try {
    projection.update({ generation: 0 });
    expect(projection.signals).toEqual(["hydrated", "owed-discovery"]);

    // A later acknowledgement is a catch-up of its own.
    projection.update({ generation: 1 });
    expect(projection.signals).toEqual([
      "hydrated",
      "owed-discovery",
      "connection-acknowledged",
    ]);
  } finally {
    projection.close();
  }
});

test("a start that is connecting leaves the owed lanes to the acknowledgement's catch-up", async () => {
  const projection = await openProjection("owed-resume-acknowledged", {
    generation: 0,
    pendingAttempt: 1,
  });
  try {
    projection.update({ generation: 0, pendingAttempt: 1 });
    expect(projection.signals).toEqual(["hydrated"]);

    projection.update({ generation: 0, pendingAttempt: 1 });
    expect(projection.signals).toEqual(["hydrated"]);

    // The catch-up lists every known lane, so each owed lane is listed once.
    projection.update({ generation: 1 });
    expect(projection.signals).toEqual(["hydrated", "connection-acknowledged"]);
  } finally {
    projection.close();
  }
});

test("a connect attempt that ends without an acknowledgement resumes the owed lanes", async () => {
  const projection = await openProjection("owed-resume-attempt-ended", {
    generation: 0,
    pendingAttempt: 1,
  });
  try {
    projection.update({ generation: 0, pendingAttempt: 1 });
    expect(projection.signals).toEqual(["hydrated"]);

    // The socket opened but never declared its interest, or the ticket failed.
    projection.update({ generation: 0 });
    expect(projection.signals).toEqual(["hydrated", "owed-discovery"]);

    // A retry does not resume again.
    projection.update({ generation: 0, pendingAttempt: 2 });
    projection.update({ generation: 0 });
    expect(projection.signals).toEqual(["hydrated", "owed-discovery"]);
  } finally {
    projection.close();
  }
});

test("a projection opened after the acknowledgement leaves the owed lanes to its catch-up", async () => {
  const projection = await openProjection("owed-resume-late-open", {
    generation: 2,
  });
  try {
    projection.update({ generation: 2 });
    expect(projection.signals).toEqual(["hydrated", "connection-acknowledged"]);
  } finally {
    projection.close();
  }
});
