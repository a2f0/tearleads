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
import { rebuildKeyringEntriesFromLog } from "../../../data/documents/shared/keyringRebuild";
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
    apiClient: {
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
  const log: ContainerKekLogResponse = {
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
      },
      {
        accessManifestHash: epoch2Kek.accessManifestHash,
        bridge: submitted[0]?.predecessorBridge ?? null,
        containerKeyEpoch: 2,
        containerKeyEpochId: epoch2Kek.containerKeyEpochId,
        keyring: epoch2Projection.containerKeks[0]?.keyring ?? null,
        parentContainerKeyEpochId: null,
      },
    ],
  };
  const rebuilt = await rebuildKeyringEntriesFromLog({
    containerId,
    currentContainerKey: rekeyed.containerKey,
    currentContainerKeyEpochId: epoch2Kek.containerKeyEpochId,
    log,
  });
  expect(rebuilt.map((entry) => entry.containerKeyEpochId)).toEqual([epoch1Id]);

  // Repair is an ordinary rekey sealing the rebuilt entries.
  const repaired = await rekeyRemoteContainer({
    apiClient: {
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
    keyringEntriesOverride: rebuilt,
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
          },
        ],
      },
    }),
  ).rejects.toThrow("does not start at epoch 1");
});
