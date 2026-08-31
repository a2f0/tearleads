import { expect, test } from "bun:test";
import { createMockApiClient } from "@symcrypt/test-utils";
import { createMemoryBlobStore } from "../../../data/blobs/memoryBlobStore";
import { defaultDocumentProjectorRegistry } from "../../../data/documents/documentKinds";
import { createDomainScope } from "../../../data/domainScope";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import {
  type ContainerCreateIntentRecord,
  defaultContainerContentsPersistence,
} from "../containerPersistence";
import { createContainerContentsWorkflowRuntime } from "../runtime";
import { createTestContainerState } from "./containerState.testFixtures";
import { syncPendingContainerCreateIntents } from "./createIntentSync";
import type { ContainerCreateIntentSyncState } from "./types";

function createIntent(containerId: string): ContainerCreateIntentRecord {
  return {
    containerId,
    createdAt: "2026-07-15T00:00:00.000Z",
    id: `create-${containerId}`,
    intentType: "container.create",
    lastAttemptedAt: null,
    lastError: null,
    parentContainerId: "parent",
    remoteContainerId: null,
    remoteMetadataAccessStateHash: null,
    remoteMetadataDocumentId: null,
    syncStatus: "pending",
    updatedAt: "2026-07-15T00:00:00.000Z",
  };
}

test("a generation change while settling create intents cannot reach a replacement executor", async () => {
  const originalExecSql: ExecSql = async () => [];
  let replacementExecutorUsed = false;
  const replacementExecSql: ExecSql = async () => {
    replacementExecutorUsed = true;
    return [];
  };
  let current = true;
  let settlementStarted = false;
  let releaseSettlement: () => void = () => {
    throw new Error("settlement promise was not initialized");
  };
  const settledContainerIds: string[] = [];
  const persistence: ContainerCreateIntentSyncState["persistence"] = {
    ...defaultContainerContentsPersistence,
    listPendingCreateIntents: async () => [
      createIntent("child-a"),
      createIntent("child-b"),
    ],
    markCreateIntentSynced: async (_execSql, input) => {
      settledContainerIds.push(input.containerId);
      settlementStarted = true;
      await new Promise<void>((resolve) => {
        releaseSettlement = resolve;
      });
    },
  };
  const runtime = createContainerContentsWorkflowRuntime({
    apiClient: createMockApiClient(),
    auth: {
      isAuthenticated: true,
      organizationId: "organization",
      userId: "user",
    },
    crypto: {
      encapsulationKeyPair: null,
      signingFingerprint: null,
      signingKeyPair: null,
    },
    infra: {
      blobStore: createMemoryBlobStore(),
      dbStatus: "ready",
      documentProjectors: defaultDocumentProjectorRegistry,
      execSql: originalExecSql,
    },
    resolveTrustedUserIdentity: async () => null,
    state: {
      containerId: "root",
      domainScope: createDomainScope(),
      events: [],
      online: true,
    },
    util: {
      log: () => undefined,
      reportSecurityIncident: async () => undefined,
    },
  });
  const state: ContainerCreateIntentSyncState = {
    containersById: new Map([
      [
        "child-a",
        createTestContainerState({ id: "child-a", parentId: "parent" }),
      ],
      [
        "child-b",
        createTestContainerState({ id: "child-b", parentId: "parent" }),
      ],
      ["parent", createTestContainerState({ id: "parent", parentId: "root" })],
    ]),
    persistence,
    resolveProjectionUserKey: async () => null,
    runtime,
  };
  const sync = syncPendingContainerCreateIntents({
    host: { persistContainerState: async () => ({ status: "missing" }) },
    isCurrent: () => current,
    isRemoteSyncBlocked: () => false,
    state,
  });

  while (!settlementStarted) {
    await Promise.resolve();
  }
  current = false;
  state.runtime = {
    ...state.runtime,
    infra: { ...state.runtime.infra, execSql: replacementExecSql },
  };
  releaseSettlement();

  await expect(sync).resolves.toBe(0);
  expect(settledContainerIds).toEqual(["child-a"]);
  expect(replacementExecutorUsed).toBe(false);
});
