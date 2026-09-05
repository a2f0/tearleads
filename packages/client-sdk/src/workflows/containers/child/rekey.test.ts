import { expect, test } from "bun:test";
import {
  normalizeContainerKekKeyring,
  openContainerKekKeyring,
} from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import type { ContainerMutationRequest } from "@tearleads/validators/request";
import type {
  ContainerKekLogResponse,
  ContainerWriterProjectionResponse,
} from "@tearleads/validators/response";
import {
  createMutationResponseFromRequest,
  createParentProjection,
  createParentProjectionUserKeyResolver,
} from "../../../../test/helpers/containerFixtures";
import { tamperSealedKeyring } from "../../../../test/helpers/keyringRotationFixtures";
import {
  rebuildKeyringEntriesFromLog,
  recoverKeyringEntryFromWraps,
} from "../../../data/documents/shared/keyringRebuild";
import { rekeyRemoteContainer } from "./rekey";

test("a poisoned keyring is rebuilt from the log and repaired by rekey", async () => {
  const parent = await createParentProjection();
  const author = parent.author;
  const database = await createTestExecSql("remote-container-rekey-repair");
  const containerId = parent.projection.containerId;
  const submitted: ContainerMutationRequest[] = [];

  // An honest explicit rotation: epoch 1 -> 2 with the keyring sealed from
  // the retiring key.
  const rekeyed = await rekeyRemoteContainer({
    reportSecurityIncident: async () => {},
    apiClient: {
      reciteContainer: async () => null,
      getContainerWriterProjection: async () => parent.projection,
      rekeyContainer: async (_containerId, request) => {
        submitted.push(request);
        return createMutationResponseFromRequest(
          request,
          parent.projection.containerKeks.at(-1),
        );
      },
    },
    author,
    containerId,
    execSql: database.execSql,
    resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
    targetSecretKey: parent.secretKey,
  });
  if (!rekeyed) {
    throw new Error("Expected the initial rekey to succeed");
  }
  const epoch2Kek = rekeyed.response.containerKek;
  const epoch1Id = parent.projection.containerKeks.at(-1)?.containerKeyEpochId;
  if (!epoch1Id || !epoch2Kek.keyring) {
    throw new Error("Expected a rotated KEK with a sealed keyring");
  }

  // The served snapshot is poisoned, but the current member wrap still
  // unwraps the current KEK, so the walk records (rather than throws) the
  // history failure and the repair plan can proceed.
  const epoch2Projection: ContainerWriterProjectionResponse = {
    ...parent.projection,
    path: [rekeyed.response.accessManifest],
    containerKeks: [
      {
        ...epoch2Kek,
        containerManifestHistory: [
          ...epoch2Kek.containerManifestHistory,
          ...parent.projection.path,
        ],
        keyring: tamperSealedKeyring(
          normalizeContainerKekKeyring(epoch2Kek.keyring),
        ),
      },
    ],
  };

  // Ground truth: the append-only log. The bridge the rotation wrote is
  // sufficient to recover epoch 1 from the current key alone.
  const log = {
    containerId,
    epochs: [
      {
        accessManifestHash:
          parent.projection.containerKeks.at(-1)?.accessManifestHash ?? "",
        bridge: null,
        containerKeyEpoch: 1,
        containerKeyEpochId: epoch1Id,
        keyring: null,
        parentContainerKeyEpochId: null,
        wraps: parent.projection.containerKeks.at(-1)?.wraps ?? [],
      },
      {
        accessManifestHash: epoch2Kek.accessManifestHash,
        bridge: submitted[0]?.predecessorBridge ?? null,
        containerKeyEpoch: 2,
        containerKeyEpochId: epoch2Kek.containerKeyEpochId,
        keyring: epoch2Projection.containerKeks[0]?.keyring ?? null,
        parentContainerKeyEpochId: null,
        wraps: epoch2Kek.wraps,
      },
    ],
  };
  const rebuilt = await rebuildKeyringEntriesFromLog({
    containerId,
    currentContainerKey: rekeyed.containerKey,
    currentContainerKeyEpochId: epoch2Kek.containerKeyEpochId,
    log,
  });
  expect(rebuilt.entries.map((entry) => entry.containerKeyEpochId)).toEqual([
    epoch1Id,
  ]);
  expect(rebuilt.missingEpochIds).toEqual([]);

  // Repair is an ordinary rekey sealing the rebuilt entries.
  const repaired = await rekeyRemoteContainer({
    reportSecurityIncident: async () => {},
    apiClient: {
      reciteContainer: async () => null,
      getContainerWriterProjection: async () => epoch2Projection,
      rekeyContainer: async (_containerId, request) => {
        submitted.push(request);
        return createMutationResponseFromRequest(
          request,
          epoch2Projection.containerKeks.at(-1),
        );
      },
    },
    author,
    containerId,
    execSql: database.execSql,
    keyringEntriesOverride: rebuilt.entries,
    resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
    targetSecretKey: parent.secretKey,
  });
  if (!repaired) {
    throw new Error("Expected the repair rekey to succeed");
  }

  const repairedKeyring = repaired.response.containerKek.keyring;
  if (!repairedKeyring) {
    throw new Error("Expected the repair to seal a keyring");
  }
  const entries = await openContainerKekKeyring({
    keyEpoch: 3,
    keyring: normalizeContainerKekKeyring(repairedKeyring),
    successorContainerKey: repaired.containerKey,
  });
  expect(entries.map((entry) => entry.containerKeyEpochId)).toEqual([
    epoch1Id,
    epoch2Kek.containerKeyEpochId,
  ]);
});

test("rebuild fails closed on a severed or non-contiguous log", async () => {
  const parent = await createParentProjection();
  const currentKek = parent.projection.containerKeks.at(-1);
  if (!currentKek) {
    throw new Error("Expected a current KEK");
  }

  await expect(
    rebuildKeyringEntriesFromLog({
      containerId: parent.projection.containerId,
      currentContainerKey: new Uint8Array(32),
      currentContainerKeyEpochId: currentKek.containerKeyEpochId,
      log: {
        containerId: parent.projection.containerId,
        epochs: [
          {
            accessManifestHash: currentKek.accessManifestHash,
            bridge: null,
            containerKeyEpoch: 2,
            containerKeyEpochId: currentKek.containerKeyEpochId,
            keyring: null,
            parentContainerKeyEpochId: null,
            wraps: [],
          },
        ],
      },
    }),
  ).rejects.toThrow("does not start at epoch 1");
});

test("a severed bridge is recovered through the retained historical wrap", async () => {
  const parent = await createParentProjection();
  const epoch1Kek = parent.projection.containerKeks.at(-1);
  if (!epoch1Kek) {
    throw new Error("Expected the epoch-1 KEK");
  }
  const database = await createTestExecSql("remote-container-wrap-recovery");
  const submitted: ContainerMutationRequest[] = [];

  // An honest rotation to epoch 2 writes the real epoch-2 bridge.
  const rekeyed = await rekeyRemoteContainer({
    reportSecurityIncident: async () => {},
    apiClient: {
      reciteContainer: async () => null,
      getContainerWriterProjection: async () => parent.projection,
      rekeyContainer: async (_containerId, request) => {
        submitted.push(request);
        return createMutationResponseFromRequest(
          request,
          parent.projection.containerKeks.at(-1),
        );
      },
    },
    author: parent.author,
    containerId: parent.projection.containerId,
    execSql: database.execSql,
    resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
    targetSecretKey: parent.secretKey,
  });
  if (!rekeyed?.response.containerKek.keyring) {
    throw new Error("Expected the rotation to seal a keyring");
  }
  const epoch2Kek = rekeyed.response.containerKek;

  // The log arrives with the epoch-2 bridge DESTROYED: log-based rebuild
  // fails closed on the missing link.
  const severedLog = {
    containerId: parent.projection.containerId,
    epochs: [
      {
        accessManifestHash: epoch1Kek.accessManifestHash,
        bridge: null,
        containerKeyEpoch: 1,
        containerKeyEpochId: epoch1Kek.containerKeyEpochId,
        keyring: null,
        parentContainerKeyEpochId: null,
        wraps: epoch1Kek.wraps,
      },
      {
        accessManifestHash: epoch2Kek.accessManifestHash,
        bridge: null,
        containerKeyEpoch: 2,
        containerKeyEpochId: epoch2Kek.containerKeyEpochId,
        keyring: null,
        parentContainerKeyEpochId: null,
        wraps: epoch2Kek.wraps,
      },
    ],
  };
  const severedRebuild = await rebuildKeyringEntriesFromLog({
    containerId: parent.projection.containerId,
    currentContainerKey: rekeyed.containerKey,
    currentContainerKeyEpochId: epoch2Kek.containerKeyEpochId,
    log: severedLog,
  });
  // The gap is named rather than thrown, so the repair knows exactly which
  // epoch needs a wrap-recovered anchor.
  expect(severedRebuild.entries).toEqual([]);
  expect(severedRebuild.missingEpochIds).toEqual([
    epoch1Kek.containerKeyEpochId,
  ]);

  // The epoch-1 recipient envelope written by the epoch-1 rotator is
  // retained forever and recovers the key independent of every bridge.
  const recovered = await recoverKeyringEntryFromWraps({
    containerId: parent.projection.containerId,
    epoch: severedLog.epochs[0] as ContainerKekLogResponse["epochs"][number],
    secretKey: parent.secretKey,
    userId: parent.userId,
  });
  expect(recovered.containerKeyEpochId).toBe(epoch1Kek.containerKeyEpochId);

  // Repair is the ordinary rekey sealing the wrap-recovered entry; the
  // repaired keyring restores the FULL history (epochs 1 and 2).
  const epoch2Projection: ContainerWriterProjectionResponse = {
    ...parent.projection,
    path: [rekeyed.response.accessManifest],
    containerKeks: [
      {
        ...epoch2Kek,
        containerManifestHistory: [
          ...epoch2Kek.containerManifestHistory,
          ...parent.projection.path,
        ],
      },
    ],
  };
  const repaired = await rekeyRemoteContainer({
    reportSecurityIncident: async () => {},
    apiClient: {
      reciteContainer: async () => null,
      getContainerWriterProjection: async () => epoch2Projection,
      rekeyContainer: async (_containerId, request) =>
        createMutationResponseFromRequest(
          request,
          epoch2Projection.containerKeks.at(-1),
        ),
    },
    author: parent.author,
    containerId: parent.projection.containerId,
    execSql: database.execSql,
    keyringEntriesOverride: [recovered],
    resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
    targetSecretKey: parent.secretKey,
  });
  if (!repaired?.response.containerKek.keyring) {
    throw new Error("Expected the repair to seal a keyring");
  }
  const entries = await openContainerKekKeyring({
    keyEpoch: 3,
    keyring: normalizeContainerKekKeyring(
      repaired.response.containerKek.keyring,
    ),
    successorContainerKey: repaired.containerKey,
  });
  expect(entries.map((entry) => entry.containerKeyEpochId)).toEqual([
    epoch1Kek.containerKeyEpochId,
    epoch2Kek.containerKeyEpochId,
  ]);
  expect(entries[0]?.keyMaterial).toEqual(recovered.keyMaterial);
});

test("a substituted keyring is rejected at acknowledgement", async () => {
  const parent = await createParentProjection();
  const database = await createTestExecSql("keyring-ack-tamper");

  await expect(
    rekeyRemoteContainer({
      reportSecurityIncident: async () => {},
      apiClient: {
        reciteContainer: async () => null,
        getContainerWriterProjection: async () => parent.projection,
        rekeyContainer: async (_containerId, request) => {
          const response = await createMutationResponseFromRequest(
            request,
            parent.projection.containerKeks.at(-1),
          );
          // A hostile server echoes a different sealed blob than the one this
          // client's signed event committed to.
          const served = response.containerKek.keyring;
          if (!served) {
            throw new Error(
              "Expected the rotation response to carry a keyring",
            );
          }
          return {
            ...response,
            containerKek: {
              ...response.containerKek,
              keyring: tamperSealedKeyring(
                normalizeContainerKekKeyring(served),
              ),
            },
          };
        },
      },
      author: parent.author,
      containerId: parent.projection.containerId,
      execSql: database.execSql,
      resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
      targetSecretKey: parent.secretKey,
    }),
  ).rejects.toThrow("keyring does not match its signed event");
});
