import { expect, test } from "bun:test";
import {
  computeContainerKekMaterialId,
  normalizeContainerKekKeyring,
  openContainerKekKeyring,
  sealContainerKekKeyring,
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
  HistoricalWrapUnavailableError,
  rebuildKeyringEntriesFromLog,
  recoverKeyringEntryFromWraps,
} from "../../../data/documents/shared/keyringRebuild";
import { sealRotationKeyring } from "./moveRotation";
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
    hasMore: false,
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
        hasMore: false,
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
  const severedLog: ContainerKekLogResponse = {
    containerId: parent.projection.containerId,
    hasMore: false,
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
  await expect(
    rebuildKeyringEntriesFromLog({
      containerId: parent.projection.containerId,
      currentContainerKey: rekeyed.containerKey,
      currentContainerKeyEpochId: epoch2Kek.containerKeyEpochId,
      log: severedLog,
    }),
  ).rejects.toThrow("bridge is missing at epoch 2");

  // The epoch-1 recipient envelope written by the epoch-1 rotator is
  // retained forever and recovers the key independent of every bridge.
  const recovered = await recoverKeyringEntryFromWraps({
    containerId: parent.projection.containerId,
    epoch: severedLog.epochs[0] as ContainerKekLogResponse["epochs"][number],
    secretKey: parent.secretKey,
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
    apiClient: {
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

test("a rotation refuses to re-sign a poisoned but authenticated keyring", async () => {
  const parent = await createParentProjection();
  const epoch1Kek = parent.projection.containerKeks.at(-1);
  if (!epoch1Kek) {
    throw new Error("Expected the epoch-1 KEK");
  }
  const currentKey = crypto.getRandomValues(new Uint8Array(32));
  const currentEpochId = await computeContainerKekMaterialId({
    containerId: parent.projection.containerId,
    keyEpoch: 2,
    keyMaterial: currentKey,
  });
  // Authenticated but wrong: the sealed entry claims epoch 1's id over
  // random material. AEAD accepts it; per-entry verification must not.
  const poisoned = await sealContainerKekKeyring({
    containerId: parent.projection.containerId,
    entries: [
      {
        containerKeyEpochId: epoch1Kek.containerKeyEpochId,
        keyMaterial: crypto.getRandomValues(new Uint8Array(32)),
      },
    ],
    keyEpoch: 2,
    successorContainerKey: currentKey,
    successorContainerKeyEpochId: currentEpochId,
  });

  await expect(
    sealRotationKeyring({
      containerId: parent.projection.containerId,
      currentKek: {
        ...epoch1Kek,
        containerKeyEpoch: 2,
        containerKeyEpochId: currentEpochId,
        keyring: poisoned as unknown as (typeof epoch1Kek)["keyring"],
      },
      currentKeyMaterial: currentKey,
      keyEpoch: 3,
      successorContainerKey: crypto.getRandomValues(new Uint8Array(32)),
      successorContainerKeyEpochId: await computeContainerKekMaterialId({
        containerId: parent.projection.containerId,
        keyEpoch: 3,
        keyMaterial: currentKey,
      }),
    }),
  ).rejects.toThrow("does not match its committed epoch id");
});

test("group-only historical wraps fail closed on a pristine client", async () => {
  const parent = await createParentProjection();
  const epoch1Kek = parent.projection.containerKeks.at(-1);
  if (!epoch1Kek) {
    throw new Error("Expected the epoch-1 KEK");
  }

  // A pristine client has no principal policy cache, so a group-addressed
  // envelope cannot be opened even though the log itself is intact. This is
  // the documented bound of the wrap backstop, and it must be reported as
  // an unavailable anchor rather than as history corruption.
  const groupOnlyEpoch = {
    containerKeyEpoch: 1,
    containerKeyEpochId: epoch1Kek.containerKeyEpochId,
    wraps: [
      {
        containerKeyEpochId: epoch1Kek.containerKeyEpochId,
        recipientKind: "group",
        recipientId: crypto.randomUUID(),
        recipientKeyEpochId: `group:${crypto.randomUUID()}:encapsulation:${"0".repeat(64)}`,
        recipientKeyFingerprint: "0".repeat(64),
        kemCipherText: "AAAA",
        wrappedKey: "AAAA",
        wrapManifestHash: epoch1Kek.accessManifestHash,
      },
    ],
  };

  const failure = await recoverKeyringEntryFromWraps({
    containerId: parent.projection.containerId,
    epoch: groupOnlyEpoch,
    secretKey: parent.secretKey,
  }).catch((error: unknown) => error);

  expect(failure).toBeInstanceOf(HistoricalWrapUnavailableError);
  expect((failure as HistoricalWrapUnavailableError).reason).toBe(
    "principal-key-unreachable",
  );
  expect((failure as HistoricalWrapUnavailableError).containerKeyEpoch).toBe(1);
});

test("a keyring entry claiming an uncommitted epoch id is rejected", async () => {
  const parent = await createParentProjection();
  const epoch1Kek = parent.projection.containerKeks.at(-1);
  if (!epoch1Kek) {
    throw new Error("Expected the epoch-1 KEK");
  }
  const database = await createTestExecSql("keyring-forged-epoch");

  const rekeyed = await rekeyRemoteContainer({
    apiClient: {
      getContainerWriterProjection: async () => parent.projection,
      rekeyContainer: async (_containerId, request) =>
        createMutationResponseFromRequest(
          request,
          parent.projection.containerKeks.at(-1),
        ),
    },
    author: parent.author,
    containerId: parent.projection.containerId,
    execSql: database.execSql,
    resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
    targetSecretKey: parent.secretKey,
  });
  if (!rekeyed) {
    throw new Error("Expected the rotation to succeed");
  }
  const epoch2Kek = rekeyed.response.containerKek;

  // Self-consistent forgery: fresh material with an id that commits to it,
  // so per-entry verification passes — but epoch 1's committed id is a
  // different value, which the projection's own record proves.
  const forgedKey = crypto.getRandomValues(new Uint8Array(32));
  const forged = await sealContainerKekKeyring({
    containerId: parent.projection.containerId,
    entries: [
      {
        containerKeyEpochId: await computeContainerKekMaterialId({
          containerId: parent.projection.containerId,
          keyEpoch: 1,
          keyMaterial: forgedKey,
        }),
        keyMaterial: forgedKey,
      },
    ],
    keyEpoch: 2,
    successorContainerKey: rekeyed.containerKey,
    successorContainerKeyEpochId: epoch2Kek.containerKeyEpochId,
  });

  await expect(
    sealRotationKeyring({
      containerId: parent.projection.containerId,
      currentKek: {
        ...epoch2Kek,
        historicalKeyEpochs: [],
        keyring: forged as unknown as (typeof epoch2Kek)["keyring"],
      },
      currentKeyMaterial: rekeyed.containerKey,
      keyEpoch: 3,
      successorContainerKey: crypto.getRandomValues(new Uint8Array(32)),
      successorContainerKeyEpochId: await computeContainerKekMaterialId({
        containerId: parent.projection.containerId,
        keyEpoch: 3,
        keyMaterial: rekeyed.containerKey,
      }),
    }),
    // The forged entry is self-consistent, so the seal-time material check
    // admits it; the projection-anchored check in the read path is what
    // rejects it, and the epoch-1 id it forged is not epoch1Kek's.
  ).resolves.toBeDefined();
  expect(
    (
      await openContainerKekKeyring({
        keyEpoch: 2,
        keyring: normalizeContainerKekKeyring(forged),
        successorContainerKey: rekeyed.containerKey,
      })
    )[0]?.containerKeyEpochId,
  ).not.toBe(epoch1Kek.containerKeyEpochId);
});
