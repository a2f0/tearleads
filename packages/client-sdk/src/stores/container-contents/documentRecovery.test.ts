import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { createDomainScope } from "../../data/domainScope";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import {
  type ContainerContentsPersistence,
  defaultContainerContentsPersistence,
} from "../../workflows/container-contents/containerPersistence";
import type { ContainerState } from "../../workflows/container-contents/remoteHydration";
import type { ContainerContentsStoreWorkflowRuntime } from "../../workflows/container-contents/runtime";
import { primeStoreDocuments, recoverStoreStaleRoot } from "./documentRecovery";

function remoteRoot(id: string): ContainerState {
  return {
    container: {
      effectiveAccessLevel: "admin",
      id,
      metadataDocumentId: `${id}-metadata`,
      organizationId: "organization-1",
      parentId: null,
      systemSlot: null,
    },
    record: {
      accessStateHash: `${id}-access-state`,
      documentId: `${id}-metadata`,
    },
  } as unknown as ContainerState;
}

test("a priming signal raised mid-pass survives for the next pass", async () => {
  const { close, execSql: baseExecSql } = await createTestExecSql(
    "document-recovery-priming-signal-race",
  );
  try {
    let signalQueryStarted = () => {};
    const queryStarted = new Promise<void>((resolve) => {
      signalQueryStarted = resolve;
    });
    let releaseSignalQuery = () => {};
    const signalQueryMayFinish = new Promise<void>((resolve) => {
      releaseSignalQuery = resolve;
    });
    let candidateQueryCount = 0;
    const execSql = (async (
      sql: string,
      bind?: Parameters<ExecSql>[1],
      options?: { rowMode?: "object" | "array" },
    ) => {
      if (sql.includes("SELECT pending.local_id AS local_id")) {
        candidateQueryCount += 1;
        if (candidateQueryCount === 1) {
          signalQueryStarted();
          await signalQueryMayFinish;
        }
      }
      return baseExecSql(sql, bind, options);
    }) as ExecSql;
    const state = {
      containersById: new Map<string, ContainerState>(),
      documentStoresNeedPriming: true,
      persistence:
        defaultContainerContentsPersistence as ContainerContentsPersistence,
      rootLaneHydrated: true,
      runtime: {
        adoptRootContainer: () => false,
        infra: { execSql },
        state: { domainScope: {} },
        util: { log: () => {} },
      } as unknown as ContainerContentsStoreWorkflowRuntime,
    };

    const firstPass = primeStoreDocuments(state);
    await queryStarted;
    expect(state.documentStoresNeedPriming).toBe(false);

    // A topology reconciliation lands while the first pass is awaiting SQL.
    state.documentStoresNeedPriming = true;
    releaseSignalQuery();
    await firstPass;

    expect(state.documentStoresNeedPriming).toBe(true);

    // Mirrors the structural lane's guard for the coalesced follow-up pass.
    if (state.documentStoresNeedPriming) {
      await primeStoreDocuments(state);
    }

    expect(candidateQueryCount).toBe(2);
    expect(state.documentStoresNeedPriming).toBe(false);
  } finally {
    close();
  }
});

test("stale root recovery logs the result and re-arms document priming", async () => {
  const logs: string[] = [];
  let adoptionCount = 0;
  let reassignmentCount = 0;
  const state = {
    containersById: new Map<string, ContainerState>([
      ["remote-root", remoteRoot("remote-root")],
    ]),
    documentStoresNeedPriming: false,
    persistence: {
      ...defaultContainerContentsPersistence,
      containerExists: async () => false,
      reassignContainerDocuments: async () => {
        reassignmentCount += 1;
      },
    },
    rootLaneHydrated: true,
    runtime: {
      adoptRootContainer: () => {
        adoptionCount += 1;
        return adoptionCount === 1 ? true : "already-adopted";
      },
      auth: {
        defaultOrganizationId: "organization-1",
        isAuthenticated: true,
        organizationId: "organization-1",
        userId: "user-1",
      },
      infra: { execSql: (() => Promise.resolve([])) as ExecSql },
      state: {
        containerId: "stale-root",
        domainScope: createDomainScope(),
      },
      util: { log: (message: string) => logs.push(message) },
    } as unknown as ContainerContentsStoreWorkflowRuntime,
  };

  await expect(recoverStoreStaleRoot(state)).resolves.toBe("reassigned");
  expect(reassignmentCount).toBe(1);
  expect(state.documentStoresNeedPriming).toBe(true);
  expect(logs).toEqual([
    "Container contents: stale root recovery status=reassigned candidates=1",
  ]);

  state.documentStoresNeedPriming = false;
  await expect(recoverStoreStaleRoot(state)).resolves.toBe("already-adopted");
  expect(state.documentStoresNeedPriming).toBe(true);
  expect(logs).toEqual([
    "Container contents: stale root recovery status=reassigned candidates=1",
    "Container contents: stale root recovery status=already-adopted candidates=1",
  ]);
});

test("stale root recovery logs status or candidate-count changes", async () => {
  const logs: string[] = [];
  const state = {
    containersById: new Map<string, ContainerState>([
      ["remote-root-1", remoteRoot("remote-root-1")],
      ["remote-root-2", remoteRoot("remote-root-2")],
    ]),
    documentStoresNeedPriming: false,
    persistence: {
      ...defaultContainerContentsPersistence,
      containerExists: async () => false,
    },
    rootLaneHydrated: true,
    runtime: {
      adoptRootContainer: () => true,
      auth: {
        defaultOrganizationId: "organization-1",
        isAuthenticated: true,
        organizationId: "organization-1",
        userId: "user-1",
      },
      infra: { execSql: (() => Promise.resolve([])) as ExecSql },
      state: {
        containerId: "stale-root",
        domainScope: createDomainScope(),
      },
      util: { log: (message: string) => logs.push(message) },
    } as unknown as ContainerContentsStoreWorkflowRuntime,
  };

  await expect(recoverStoreStaleRoot(state)).resolves.toBe("ambiguous");
  state.containersById.set("remote-root-3", remoteRoot("remote-root-3"));
  await expect(recoverStoreStaleRoot(state)).resolves.toBe("ambiguous");
  await expect(recoverStoreStaleRoot(state)).resolves.toBe("ambiguous");

  expect(logs).toEqual([
    "Container contents: stale root recovery status=ambiguous candidates=2",
    "Container contents: stale root recovery status=ambiguous candidates=3",
    "Container contents: stale root recovery status=ambiguous candidates=3 occurrences=2",
  ]);
});

test("stale root recovery contains transient persistence failures", async () => {
  const error = new Error("temporary SQLite failure");
  const loggedErrors: Array<{ cause: unknown; message: string | Error }> = [];
  const state = {
    containersById: new Map<string, ContainerState>(),
    documentStoresNeedPriming: false,
    persistence: {
      ...defaultContainerContentsPersistence,
      containerExists: async () => Promise.reject(error),
    },
    rootLaneHydrated: true,
    runtime: {
      adoptRootContainer: () => true,
      auth: {
        defaultOrganizationId: "organization-1",
        isAuthenticated: true,
        organizationId: "organization-1",
        userId: "user-1",
      },
      infra: { execSql: (() => Promise.resolve([])) as ExecSql },
      state: {
        containerId: "stale-root",
        domainScope: createDomainScope(),
      },
      util: {
        log: () => {},
        logError: (message: string | Error, cause?: unknown) =>
          loggedErrors.push({ cause, message }),
      },
    } as unknown as ContainerContentsStoreWorkflowRuntime,
  };

  await expect(recoverStoreStaleRoot(state)).resolves.toBe("not-needed");
  expect(state.documentStoresNeedPriming).toBe(false);
  expect(loggedErrors).toEqual([
    {
      cause: error,
      message: "Container contents: stale root recovery failed",
    },
  ]);
});

test("stale root recovery falls back to plain logging", async () => {
  const logs: string[] = [];
  const state = {
    containersById: new Map<string, ContainerState>(),
    documentStoresNeedPriming: false,
    persistence: {
      ...defaultContainerContentsPersistence,
      containerExists: async () =>
        Promise.reject(new Error("temporary failure")),
    },
    rootLaneHydrated: true,
    runtime: {
      adoptRootContainer: () => true,
      auth: {
        defaultOrganizationId: "organization-1",
        isAuthenticated: true,
        organizationId: "organization-1",
        userId: "user-1",
      },
      infra: { execSql: (() => Promise.resolve([])) as ExecSql },
      state: {
        containerId: "stale-root",
        domainScope: createDomainScope(),
      },
      util: { log: (message: string) => logs.push(message) },
    } as unknown as ContainerContentsStoreWorkflowRuntime,
  };

  await expect(recoverStoreStaleRoot(state)).resolves.toBe("not-needed");
  expect(logs).toEqual(["Container contents: stale root recovery failed"]);
});

test("stale root recovery rethrows database-unavailable failures", async () => {
  const error = new Error("DB has been closed.");
  const loggedErrors: unknown[] = [];
  const state = {
    containersById: new Map<string, ContainerState>(),
    documentStoresNeedPriming: false,
    persistence: {
      ...defaultContainerContentsPersistence,
      containerExists: async () => Promise.reject(error),
    },
    rootLaneHydrated: true,
    runtime: {
      adoptRootContainer: () => true,
      auth: {
        defaultOrganizationId: "organization-1",
        isAuthenticated: true,
        organizationId: "organization-1",
        userId: "user-1",
      },
      infra: { execSql: (() => Promise.resolve([])) as ExecSql },
      state: {
        containerId: "stale-root",
        domainScope: createDomainScope(),
      },
      util: {
        log: () => {},
        logError: (...args: unknown[]) => loggedErrors.push(args),
      },
    } as unknown as ContainerContentsStoreWorkflowRuntime,
  };

  await expect(recoverStoreStaleRoot(state)).rejects.toBe(error);
  expect(loggedErrors).toEqual([]);
});

test("stale root recovery retries a rejected adoption only after a runtime update", async () => {
  let reassignmentCount = 0;
  const runtime = {
    adoptRootContainer: () => false,
    auth: {
      defaultOrganizationId: "organization-1",
      isAuthenticated: true,
      organizationId: "organization-1",
      userId: "user-1",
    },
    infra: { execSql: (() => Promise.resolve([])) as ExecSql },
    state: {
      containerId: "stale-root",
      domainScope: createDomainScope(),
    },
    util: { log: () => {} },
  } as unknown as ContainerContentsStoreWorkflowRuntime;
  const state = {
    containersById: new Map<string, ContainerState>([
      ["remote-root", remoteRoot("remote-root")],
    ]),
    documentStoresNeedPriming: false,
    persistence: {
      ...defaultContainerContentsPersistence,
      containerExists: async () => false,
      reassignContainerDocuments: async () => {
        reassignmentCount += 1;
      },
    },
    rootLaneHydrated: true,
    runtime,
  };

  await expect(recoverStoreStaleRoot(state)).resolves.toBe("context-changed");
  expect(state.documentStoresNeedPriming).toBe(true);
  await expect(recoverStoreStaleRoot(state)).resolves.toBe("not-needed");
  expect(reassignmentCount).toBe(1);

  state.runtime = { ...runtime };
  await expect(recoverStoreStaleRoot(state)).resolves.toBe("context-changed");
  expect(reassignmentCount).toBe(2);
});
