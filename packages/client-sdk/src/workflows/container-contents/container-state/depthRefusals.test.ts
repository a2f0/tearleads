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
import {
  CONTAINER_PATH_TOO_DEEP_MESSAGE,
  ContainerPathTooDeepError,
} from "../../../data/containers/shared/containerPathLimits";
import { createDomainScope } from "../../../data/domainScope";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import {
  type ContainerCreateIntentRecord,
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

test("a create refused for path length waits for a local move instead of refetching", async () => {
  // A shared tree whose higher ancestors this device does not hold passes the
  // local check; the verified plan refuses it instead.
  const containersById = localChain(2);
  containersById.set(
    "child",
    createTestContainerState({ id: "child", parentId: "c1", synced: false }),
  );
  let intent: ContainerCreateIntentRecord = {
    containerId: "child",
    createdAt: "2026-09-29T00:00:00.000Z",
    id: "create-child",
    intentType: "container.create",
    lastAttemptedAt: null,
    lastError: null,
    parentContainerId: "c1",
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
        intent = { ...intent, lastError: input.message };
      },
    },
  });
  const pass = () =>
    syncPendingContainerCreateIntents({
      host: noHost,
      isCurrent: () => true,
      isRemoteSyncBlocked: () => false,
      requestRemoteReconciliation: () => {},
      state,
    });

  await expect(pass()).resolves.toBe(0);
  await expect(pass()).resolves.toBe(0);
  expect(projectionRequests).toBe(1);
  expect(recorded).toEqual([CONTAINER_PATH_TOO_DEEP_MESSAGE]);
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
  await defaultContainerContentsPersistence.ensureSchema(database.execSql);
  // The local move already placed the folder under its destination.
  const movedLocally = createTestContainerState({
    id: "moved",
    organizationId: author.organizationId,
    parentId: "destination",
  });
  await defaultContainerContentsPersistence.saveContainer(
    database.execSql,
    movedLocally.container,
    movedLocally.record,
    {
      moveIntent: {
        parentContainerId: "destination",
        previousParentContainerId: "root",
      },
    },
  );
  const retried: string[] = [];
  const reconciled: (string | null)[] = [];
  let submissions = 0;
  const state = syncState({
    containersById: new Map([
      ...["root", "destination"].map(
        (id) =>
          [
            id,
            createTestContainerState({
              id,
              organizationId: author.organizationId,
              parentId: id === "root" ? null : "root",
            }),
          ] as const,
      ),
      ["moved", movedLocally] as const,
    ]),
    onProjectionRequest: () => {},
    persistence: {
      ...defaultContainerContentsPersistence,
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

  let remaining: unknown[] = [];
  let stored: Awaited<
    ReturnType<
      typeof defaultContainerContentsPersistence.loadContainerMetadataState
    >
  > = null;
  try {
    await expect(
      syncPendingContainerMoveIntents({
        isCreatePending: () => false,
        host: noHost,
        isCurrent: () => true,
        isRemoteSyncBlocked: () => false,
        requestRemoteReconciliation: (parentId) => {
          reconciled.push(parentId);
        },
        state: withMove,
      }),
    ).resolves.toBe(0);
    remaining =
      await defaultContainerContentsPersistence.listUnsyncedMoveIntents(
        database.execSql,
      );
    stored =
      await defaultContainerContentsPersistence.loadContainerMetadataState(
        database.execSql,
        "moved",
      );
  } finally {
    database.close();
  }
  expect(submissions).toBe(1);
  expect(retried).toEqual([]);
  expect(reconciled).toEqual([]);
  // The server row never changed, so the folder must be back locally now.
  expect(movedLocally.container.parentId).toBe("root");
  expect(remaining).toEqual([]);
  expect(stored?.container.parentId).toBe("root");
}, 30_000);
