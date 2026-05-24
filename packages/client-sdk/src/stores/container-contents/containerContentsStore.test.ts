import { expect, test } from "bun:test";
import type { BlobStore } from "../../data/blobContracts";
import type { DomainScope } from "../../data/domainScope";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import {
  type ContainerContentsPersistence,
  defaultContainerContentsPersistence,
} from "../../workflows/container-contents/containerPersistence";
import { createContainerContentsWorkflowRuntime } from "../../workflows/container-contents/runtime";
import { getOrCreateContainerContentsStore } from "./containerContentsStore";

function createTestRuntime(input: {
  domainScope: DomainScope;
  log: (message: string) => void;
}) {
  const execSql: ExecSql = async () => {
    throw new Error("Unexpected SQL call in container contents store test.");
  };

  return createContainerContentsWorkflowRuntime({
    apiClient: {} as Parameters<
      typeof createContainerContentsWorkflowRuntime
    >[0]["apiClient"],
    blobStore: {} as BlobStore,
    cacheReferencedPrincipalPolicies: async () => {},
    dbStatus: "ready",
    domainScope: input.domainScope,
    events: [],
    execSql,
    isAuthenticated: false,
    log: input.log,
    online: false,
  });
}

test("getOrCreateContainerContentsStore applies updated options to the cached scope store", async () => {
  const domainScope = {} as DomainScope;
  const logs: string[] = [];
  let ensureSchemaCalls = 0;
  let loadContainersCalls = 0;
  const persistence: ContainerContentsPersistence = {
    ...defaultContainerContentsPersistence,
    ensureSchema: async () => {
      ensureSchemaCalls += 1;
    },
    loadContainers: async () => {
      loadContainersCalls += 1;
      return [];
    },
  };
  const runtime = createTestRuntime({
    domainScope,
    log: (message) => logs.push(message),
  });

  const store = getOrCreateContainerContentsStore(domainScope, runtime, {
    logLabel: "Initial label",
  });
  const sameStore = getOrCreateContainerContentsStore(domainScope, runtime, {
    logLabel: "Updated label",
    persistence,
  });

  expect(sameStore).toBe(store);

  const initialized = new Promise<void>((resolve) => {
    const unsubscribe = sameStore.subscribe(() => {
      if (sameStore.getSnapshot().ready) {
        unsubscribe();
        resolve();
      }
    });
  });
  sameStore.updateRuntime(runtime);
  await initialized;

  expect(ensureSchemaCalls).toBe(1);
  expect(loadContainersCalls).toBe(1);
  expect(logs).toContain("Updated label: loaded 0 container(s)");
});
