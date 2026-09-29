import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import {
  createContainerWriterProjectionFixture,
  createMockApiClient,
  createTestExecSql,
} from "@tearleads/test-utils";
import { CONTAINER_MUTATION_ERROR_CODES } from "@tearleads/validators/response";
import { MAX_CONTAINER_PATH_LENGTH } from "@tearleads/validators/util";
import { createAuthor } from "../../../../test/helpers/documentFixturePrimitives";
import { createTestTrustedUserIdentityResolver } from "../../../../test/helpers/trustedUserIdentity";
import { ContainerPathTooDeepError } from "../../../data/containers/shared/containerPathLimits";
import { createDomainScope } from "../../../data/domainScope";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import {
  type ContainerCreateIntentRecord,
  type ContainerMoveIntentRecord,
  defaultContainerContentsPersistence,
} from "../containerPersistence";
import type { ContainerState } from "../remoteHydration";
import { createTestContainerState } from "./containerState.testFixtures";
import { syncPendingContainerCreateIntents } from "./createIntentSync";
import { syncPendingContainerMoveIntents } from "./moveIntentSync";
import type { ContainerCreateIntentSyncState } from "./types";

/** A local chain of `length` synced containers, root first: c0 … c{length-1}. */
function localChain(length: number): Map<string, ContainerState> {
  return new Map(
    Array.from({ length }, (_, index) => [
      `c${index}`,
      createTestContainerState({
        id: `c${index}`,
        parentId: index === 0 ? null : `c${index - 1}`,
      }),
    ]),
  );
}

function syncState(input: {
  containersById: Map<string, ContainerState>;
  onProjectionRequest: () => void;
  persistence: ContainerCreateIntentSyncState["persistence"];
}): ContainerCreateIntentSyncState {
  const execSql: ExecSql = async () => [];
  return {
    containersById: input.containersById,
    persistence: input.persistence,
    resolveProjectionUserKey: async () => null,
    runtime: {
      apiClient: createMockApiClient({
        getContainerWriterProjection: async () => {
          input.onProjectionRequest();
          throw new ContainerPathTooDeepError();
        },
      }),
      auth: {
        isAuthenticated: true,
        organizationId: "organization",
        userId: "user",
      },
      crypto: {
        encapsulationKeyPair: {
          secretKey: new Uint8Array(32),
        } as ContainerCreateIntentSyncState["runtime"]["crypto"]["encapsulationKeyPair"],
        signingFingerprint: "signing-fingerprint",
        signingKeyPair: {
          signingPrivateKey: new Uint8Array(32),
        } as ContainerCreateIntentSyncState["runtime"]["crypto"]["signingKeyPair"],
      },
      infra: {
        blobStore:
          {} as ContainerCreateIntentSyncState["runtime"]["infra"]["blobStore"],
        dbStatus: "ready",
        documentProjectors:
          {} as ContainerCreateIntentSyncState["runtime"]["infra"]["documentProjectors"],
        execSql,
      },
      resolveTrustedUserIdentity: async () => null,
      state: {
        containerId: "c0",
        domainScope: createDomainScope(),
        events: [],
        online: true,
      },
      util: { log: () => {}, reportSecurityIncident: async () => {} },
    },
  };
}

const noHost = {
  persistContainerState: async () => {
    throw new Error("unexpected persist");
  },
  updateSnapshot: () => {},
};

test("a queued create whose local path is too deep waits without a request", async () => {
  const containersById = localChain(MAX_CONTAINER_PATH_LENGTH);
  const deepest = `c${MAX_CONTAINER_PATH_LENGTH - 1}`;
  containersById.set(
    "child",
    createTestContainerState({ id: "child", parentId: deepest, synced: false }),
  );
  const intent: ContainerCreateIntentRecord = {
    containerId: "child",
    createdAt: "2026-09-29T00:00:00.000Z",
    id: "create-child",
    intentType: "container.create",
    lastAttemptedAt: null,
    lastError: null,
    parentContainerId: deepest,
    remoteContainerId: null,
    remoteMetadataAccessStateHash: null,
    remoteMetadataDocumentId: null,
    syncStatus: "pending",
    updatedAt: "2026-09-29T00:00:00.000Z",
  };
  const recorded: string[] = [];
  let projectionRequests = 0;
  const state = syncState({
    containersById,
    onProjectionRequest: () => {
      projectionRequests += 1;
    },
    persistence: {
      ...defaultContainerContentsPersistence,
      listPendingCreateIntents: async () => [intent],
      recordCreateIntentRevisionError: async (_execSql, input) => {
        recorded.push(input.message);
      },
    },
  });

  await expect(
    syncPendingContainerCreateIntents({
      host: noHost,
      isCurrent: () => true,
      isRemoteSyncBlocked: () => false,
      requestRemoteReconciliation: () => {},
      state,
    }),
  ).resolves.toBe(0);
  expect(projectionRequests).toBe(0);
  expect(recorded).toEqual(["Container path exceeds maximum depth"]);
});

test("a queued move the server refuses for path length is abandoned, not retried", async () => {
  const { author, signingPublicKey } = await createAuthor();
  const kem = generateKemSeedAndKeyPair();
  const signer = {
    encapsulationPublicKey: kem.publicKey,
    organizationId: author.organizationId,
    signerDeviceId: author.signerDeviceId,
    signerKeyFingerprint: author.signerKeyFingerprint,
    signerPrivateKey: author.signerPrivateKey,
    userId: author.signerUserId,
  };
  const root = await createContainerWriterProjectionFixture({
    ...signer,
    containerId: "root",
  });
  const [moved, destination] = await Promise.all(
    ["moved", "destination"].map((containerId) =>
      createContainerWriterProjectionFixture({
        ...signer,
        containerId,
        parentProjection: root,
      }),
    ),
  );
  if (!moved || !destination) throw new Error("Expected signed fixtures");
  const database = await createTestExecSql("container-depth-abandon");
  const intent: ContainerMoveIntentRecord = {
    containerId: "moved",
    createdAt: "2026-09-29T00:00:00.000Z",
    id: "move-moved",
    intentType: "container.move",
    lastAttemptedAt: null,
    lastError: null,
    parentContainerId: "destination",
    previousParentContainerId: "root",
    syncStatus: "pending",
    updatedAt: "2026-09-29T00:00:00.000Z",
  };
  const dropped: string[] = [];
  const retried: string[] = [];
  const reconciled: (string | null)[] = [];
  let submissions = 0;
  const state = syncState({
    containersById: new Map(
      ["root", "moved", "destination"].map((id) => [
        id,
        createTestContainerState({
          id,
          organizationId: author.organizationId,
          parentId: id === "root" ? null : "root",
        }),
      ]),
    ),
    onProjectionRequest: () => {},
    persistence: {
      ...defaultContainerContentsPersistence,
      listUnsyncedMoveIntents: async () => [intent],
      markMoveIntentRevisionSynced: async (_execSql, input) => {
        dropped.push(input.expectedIntentId);
        return true;
      },
      recordMoveIntentError: async (_execSql, input) => {
        retried.push(input.message);
      },
    },
  });
  // The descendants the server counts are ones this device cannot see.
  const withMove = {
    ...state,
    resolveProjectionUserKey: createTestTrustedUserIdentityResolver({
      encapsulationPublicKey: kem.publicKey,
      signingKeyFingerprint: author.signerKeyFingerprint,
      signingPublicKey,
      userId: author.signerUserId,
    }),
    runtime: {
      ...state.runtime,
      apiClient: createMockApiClient({
        getContainerWriterProjection: async (id) =>
          id === "moved" ? moved : destination,
        moveContainerResult: async () => {
          submissions += 1;
          return {
            code: CONTAINER_MUTATION_ERROR_CODES.pathTooDeep,
            kind: "http" as const,
            message: "Container path exceeds maximum depth",
            method: "POST" as const,
            ok: false as const,
            path: "/containers/moved/move",
            report: () => {},
            status: 409,
            statusText: "Conflict",
          };
        },
      }),
      auth: {
        isAuthenticated: true,
        organizationId: author.organizationId,
        userId: author.signerUserId,
      },
      crypto: {
        encapsulationKeyPair: kem,
        signingFingerprint: author.signerKeyFingerprint,
        signingKeyPair: {
          signingPrivateKey: author.signerPrivateKey,
          signingPublicKey,
        },
      },
      infra: { ...state.runtime.infra, execSql: database.execSql },
    },
  } as ContainerCreateIntentSyncState;

  try {
    await expect(
      syncPendingContainerMoveIntents({
        host: noHost,
        isCurrent: () => true,
        isRemoteSyncBlocked: () => false,
        requestRemoteReconciliation: (parentId) => {
          reconciled.push(parentId);
        },
        state: withMove,
      }),
    ).resolves.toBe(0);
  } finally {
    database.close();
  }
  expect(submissions).toBe(1);
  expect(dropped).toEqual(["move-moved"]);
  expect(retried).toEqual([]);
  expect(reconciled).toEqual(["root"]);
}, 30_000);
