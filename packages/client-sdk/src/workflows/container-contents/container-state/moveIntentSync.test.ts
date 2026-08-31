import { expect, test } from "bun:test";
import { KeyingVerificationError } from "@symcrypt/crypto";
import { createDomainScope } from "../../../data/domainScope";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import {
  type ContainerMoveIntentRecord,
  defaultContainerContentsPersistence,
} from "../containerPersistence";
import type { ContainerState } from "../remoteHydration";
import { createTestContainerState } from "./containerState.testFixtures";
import {
  persistAcceptedMoveIntent,
  syncPendingContainerMoveIntents,
} from "./moveIntentSync";
import type { ContainerMoveIntentSyncState } from "./types";

type MoveIntentError = Parameters<
  ContainerMoveIntentSyncState["persistence"]["recordMoveIntentError"]
>[1];

function createMoveIntentSyncState(input: {
  containersById: Map<string, ContainerState>;
  persistence: ContainerMoveIntentSyncState["persistence"];
  projectionError?: unknown;
}): ContainerMoveIntentSyncState {
  const execSql: ExecSql = async () => [];
  return {
    containersById: input.containersById,
    persistence: input.persistence,
    resolveProjectionUserKey: async () => null,
    runtime: {
      apiClient: {
        getContainerWriterProjection: () => {
          if (input.projectionError !== undefined) {
            throw input.projectionError;
          }
          throw new Error("projection unavailable");
        },
      } as unknown as ContainerMoveIntentSyncState["runtime"]["apiClient"],
      auth: {
        isAuthenticated: true,
        organizationId: "organization",
        userId: "user",
      },
      crypto: {
        encapsulationKeyPair: {
          secretKey: new Uint8Array(32),
        } as ContainerMoveIntentSyncState["runtime"]["crypto"]["encapsulationKeyPair"],
        signingFingerprint: "signing-fingerprint",
        signingKeyPair: {
          signingPrivateKey: new Uint8Array(32),
        } as ContainerMoveIntentSyncState["runtime"]["crypto"]["signingKeyPair"],
      },
      infra: {
        blobStore:
          {} as ContainerMoveIntentSyncState["runtime"]["infra"]["blobStore"],
        dbStatus: "ready",
        documentProjectors:
          {} as ContainerMoveIntentSyncState["runtime"]["infra"]["documentProjectors"],
        execSql,
      },
      resolveTrustedUserIdentity: async () => null,
      state: {
        containerId: "root",
        domainScope: createDomainScope(),
        events: [],
        online: true,
      },
      util: {
        log: () => {},
        reportSecurityIncident: async () => undefined,
      },
    },
  };
}

function moveIntentRecord(
  input: Partial<ContainerMoveIntentRecord> & { containerId: string },
): ContainerMoveIntentRecord {
  return {
    createdAt: "2026-05-31T00:00:00.000Z",
    id: `intent-${input.containerId}`,
    intentType: "container.move",
    lastAttemptedAt: null,
    lastError: null,
    parentContainerId: "parent",
    previousParentContainerId: "root",
    syncStatus: "pending",
    updatedAt: "2026-05-31T00:00:00.000Z",
    ...input,
  };
}

test("pending container move sync records per-intent failures and continues", async () => {
  const errors: MoveIntentError[] = [];
  const parentState = createTestContainerState({
    id: "parent",
    parentId: "root",
  });
  const containersById = new Map([
    [
      "child-a",
      createTestContainerState({
        id: "child-a",
        parentId: "root",
      }),
    ],
    [
      "child-b",
      createTestContainerState({
        id: "child-b",
        parentId: "root",
      }),
    ],
    ["parent", parentState],
  ]);
  const pendingIntents: ContainerMoveIntentRecord[] = [
    moveIntentRecord({ containerId: "child-a", id: "intent-a" }),
    moveIntentRecord({ containerId: "child-b", id: "intent-b" }),
  ];
  const persistence: ContainerMoveIntentSyncState["persistence"] = {
    ...defaultContainerContentsPersistence,
    listUnsyncedMoveIntents: async () => pendingIntents,
    recordMoveIntentError: async (_execSql, error) => {
      errors.push(error);
    },
  };

  const movedCount = await syncPendingContainerMoveIntents({
    host: {
      persistContainerState: async () => {
        throw new Error("unexpected persist");
      },
      updateSnapshot: () => {},
    },
    isCurrent: () => true,
    isRemoteSyncBlocked: () => false,
    state: createMoveIntentSyncState({ containersById, persistence }),
  });

  expect(movedCount).toBe(0);
  expect(errors.map((error) => error.containerId)).toEqual([
    "child-a",
    "child-b",
  ]);
  expect(errors.map((error) => error.message)).toEqual([
    "Failed to sync container move: projection unavailable",
    "Failed to sync container move: projection unavailable",
  ]);
});

test("container move sync propagates identity failures without recording a retry", async () => {
  const integrityError = new KeyingVerificationError(
    "equivocation",
    "trusted identity changed",
  );
  const errors: MoveIntentError[] = [];
  const containersById = new Map([
    ["child", createTestContainerState({ id: "child", parentId: "root" })],
    ["parent", createTestContainerState({ id: "parent", parentId: "root" })],
  ]);
  const persistence: ContainerMoveIntentSyncState["persistence"] = {
    ...defaultContainerContentsPersistence,
    listUnsyncedMoveIntents: async () => [
      moveIntentRecord({ containerId: "child" }),
    ],
    recordMoveIntentError: async (_execSql, error) => {
      errors.push(error);
    },
  };

  await expect(
    syncPendingContainerMoveIntents({
      host: {
        persistContainerState: async () => {
          throw new Error("unexpected persist");
        },
        updateSnapshot: () => {},
      },
      isCurrent: () => true,
      isRemoteSyncBlocked: () => false,
      state: createMoveIntentSyncState({
        containersById,
        persistence,
        projectionError: integrityError,
      }),
    }),
  ).rejects.toBe(integrityError);
  expect(errors).toEqual([]);
});

test("a blocked organization does not prevent another organization's move from syncing", async () => {
  const errors: MoveIntentError[] = [];
  const containersById = new Map([
    [
      "custom-child",
      createTestContainerState({
        id: "custom-child",
        organizationId: "custom-organization",
        parentId: "custom-root",
      }),
    ],
    [
      "custom-parent",
      createTestContainerState({
        id: "custom-parent",
        organizationId: "custom-organization",
        parentId: "custom-root",
      }),
    ],
    [
      "personal-child",
      createTestContainerState({
        id: "personal-child",
        organizationId: "personal-organization",
        parentId: "personal-root",
      }),
    ],
    [
      "personal-parent",
      createTestContainerState({
        id: "personal-parent",
        organizationId: "personal-organization",
        parentId: "personal-root",
      }),
    ],
  ]);
  const persistence: ContainerMoveIntentSyncState["persistence"] = {
    ...defaultContainerContentsPersistence,
    listUnsyncedMoveIntents: async () => [
      moveIntentRecord({
        containerId: "custom-child",
        parentContainerId: "custom-parent",
      }),
      moveIntentRecord({
        containerId: "personal-child",
        parentContainerId: "personal-parent",
      }),
    ],
    recordMoveIntentError: async (_execSql, error) => {
      errors.push(error);
    },
  };
  const checkedOrganizations: string[] = [];

  const movedCount = await syncPendingContainerMoveIntents({
    host: {
      persistContainerState: async () => {
        throw new Error("unexpected persist");
      },
      updateSnapshot: () => {},
    },
    isCurrent: () => true,
    isRemoteSyncBlocked: (organizationId) => {
      checkedOrganizations.push(organizationId);
      return organizationId === "custom-organization";
    },
    state: createMoveIntentSyncState({ containersById, persistence }),
  });

  expect(movedCount).toBe(0);
  expect(checkedOrganizations).toEqual([
    "custom-organization",
    "personal-organization",
  ]);
  expect(errors.map((error) => error.containerId)).toEqual(["personal-child"]);
  expect(errors[0]?.message).toBe(
    "Failed to sync container move: projection unavailable",
  );
});

test("a move whose source is not synced yet stays pending and retryable", async () => {
  // Regression: source-not-synced used to record blocked:true, which the
  // then-'pending'-only sync list dropped permanently — so a move attempted
  // before its source's create landed (e.g. a transient create failure on the
  // same pass) never propagated, even after the source finished syncing. It
  // must stay 'pending' (not 'blocked') and retry, like the
  // destination-not-synced case.
  const errors: MoveIntentError[] = [];
  const containersById = new Map([
    // Source exists locally but has no remote metadata yet.
    [
      "child-a",
      createTestContainerState({
        id: "child-a",
        parentId: "root",
        synced: false,
      }),
    ],
    ["parent", createTestContainerState({ id: "parent", parentId: "root" })],
  ]);
  const persistence: ContainerMoveIntentSyncState["persistence"] = {
    ...defaultContainerContentsPersistence,
    listUnsyncedMoveIntents: async () => [
      moveIntentRecord({ containerId: "child-a", id: "intent-a" }),
    ],
    recordMoveIntentError: async (_execSql, error) => {
      errors.push(error);
    },
  };

  const movedCount = await syncPendingContainerMoveIntents({
    host: {
      persistContainerState: async () => {
        throw new Error("unexpected persist");
      },
      updateSnapshot: () => {},
    },
    isCurrent: () => true,
    isRemoteSyncBlocked: () => false,
    state: createMoveIntentSyncState({ containersById, persistence }),
  });

  expect(movedCount).toBe(0);
  expect(errors).toHaveLength(1);
  expect(errors[0]?.containerId).toBe("child-a");
  expect(errors[0]?.message).toBe("Container move source is not synced yet");
  // Must NOT be blocked: the failure is transient, so the queue must report a
  // retryable 'pending' intent, not a missing-dependency block.
  expect(errors[0]?.blocked).toBeFalsy();
});

test("an accepted remote move is not settled when local persistence observes deletion", async () => {
  const child = createTestContainerState({
    id: "child",
    parentId: "root",
  });
  const containersById = new Map([["child", child]]);
  let settled = false;
  const persistence: ContainerMoveIntentSyncState["persistence"] = {
    ...defaultContainerContentsPersistence,
    markMoveIntentSynced: async () => {
      settled = true;
    },
  };
  const state = createMoveIntentSyncState({ containersById, persistence });

  const persisted = await persistAcceptedMoveIntent({
    host: {
      persistContainerState: async () => ({ status: "missing" }),
      updateSnapshot: () => {},
    },
    isCurrent: () => true,
    intent: moveIntentRecord({ containerId: "child" }),
    moved: {
      createdAt: "2026-05-31T00:00:00.000Z",
      effectiveAccessLevel: "admin",
      id: "child",
      metadataAccessEpoch: 2,
      metadataAccessStateHash: "access-after-move",
      metadataDocumentId: "metadata-after-move",
      metadataReferencedPrincipals: [],
      organizationId: "organization",
      parentId: "parent",
      updatedAt: "2026-05-31T00:01:00.000Z",
    },
    state,
  });

  expect(persisted).toBe(false);
  expect(settled).toBe(false);
});

test("a generation change during move persistence cannot settle on a replacement executor", async () => {
  const child = createTestContainerState({ id: "child", parentId: "root" });
  const originalMetadataDocumentId = child.container.metadataDocumentId;
  let current = true;
  let persistenceStarted = false;
  let releasePersistence: () => void = () => {
    throw new Error("persistence promise was not initialized");
  };
  let persistedGuard: (() => boolean) | undefined;
  let settled = false;
  const persistence: ContainerMoveIntentSyncState["persistence"] = {
    ...defaultContainerContentsPersistence,
    markMoveIntentSynced: async () => {
      settled = true;
    },
  };
  const state = createMoveIntentSyncState({
    containersById: new Map([["child", child]]),
    persistence,
  });
  const replacementExecSql: ExecSql = async () => {
    throw new Error("replacement executor must remain untouched");
  };
  const persisted = persistAcceptedMoveIntent({
    host: {
      persistContainerState: async (
        _containerState,
        _patch,
        _updateView,
        _saveOptions,
        mutationOptions,
      ) => {
        persistedGuard = mutationOptions?.isCurrent;
        persistenceStarted = true;
        await new Promise<void>((resolve) => {
          releasePersistence = resolve;
        });
        return { record: child.record, status: "persisted" };
      },
      updateSnapshot: () => {},
    },
    isCurrent: () => current,
    intent: moveIntentRecord({ containerId: "child" }),
    moved: {
      createdAt: "2026-05-31T00:00:00.000Z",
      effectiveAccessLevel: "admin",
      id: "child",
      metadataAccessEpoch: 2,
      metadataAccessStateHash: "access-after-move",
      metadataDocumentId: "metadata-after-move",
      metadataReferencedPrincipals: [],
      organizationId: "organization",
      parentId: "parent",
      updatedAt: "2026-05-31T00:01:00.000Z",
    },
    state,
  });

  while (!persistenceStarted) {
    await Promise.resolve();
  }
  current = false;
  state.runtime = {
    ...state.runtime,
    infra: { ...state.runtime.infra, execSql: replacementExecSql },
  };
  releasePersistence();

  await expect(persisted).resolves.toBe(false);
  expect(persistedGuard?.()).toBe(false);
  expect(settled).toBe(false);
  expect(child.container.metadataDocumentId).toBe(originalMetadataDocumentId);
});
