import { expect, test } from "bun:test";
import {
  computeContainerKekMaterialId,
  encryptWithDek,
  normalizeContainerKekKeyring,
  openContainerKekKeyring,
  sealContainerKekKeyring,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  createMutationResponseFromRequest,
  createParentProjection,
  createParentProjectionUserKeyResolver,
} from "../../../../test/helpers/containerFixtures";
import {
  HistoricalWrapUnavailableError,
  recoverKeyringEntryFromWraps,
} from "../../../data/documents/shared/keyringRebuild";
import { sealRotationKeyring } from "./moveRotation";
import { rekeyRemoteContainer } from "./rekey";

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
    userId: parent.userId,
  }).catch((error: unknown) => error);

  expect(failure).toBeInstanceOf(HistoricalWrapUnavailableError);
  expect((failure as HistoricalWrapUnavailableError).reason).toBe(
    "principal-key-unreachable",
  );
  expect((failure as HistoricalWrapUnavailableError).containerKeyEpoch).toBe(1);
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

test("another member's envelope is not treated as this requester's anchor", async () => {
  const parent = await createParentProjection();
  const epoch1Kek = parent.projection.containerKeks.at(-1);
  if (!epoch1Kek) {
    throw new Error("Expected the epoch-1 KEK");
  }

  // A user envelope addressed to somebody else: attempting it would produce
  // a misleading corruption verdict, so it must not count as an anchor.
  const otherMemberEpoch = {
    containerKeyEpoch: 1,
    containerKeyEpochId: epoch1Kek.containerKeyEpochId,
    wraps: [
      {
        containerKeyEpochId: epoch1Kek.containerKeyEpochId,
        recipientKind: "user",
        recipientId: crypto.randomUUID(),
        recipientKeyEpochId: `user:other:encapsulation:${"0".repeat(64)}`,
        recipientKeyFingerprint: "0".repeat(64),
        kemCipherText: "AAAA",
        wrappedKey: "AAAA",
        wrapManifestHash: epoch1Kek.accessManifestHash,
      },
    ],
  };

  const failure = await recoverKeyringEntryFromWraps({
    containerId: parent.projection.containerId,
    epoch: otherMemberEpoch,
    secretKey: parent.secretKey,
    userId: parent.userId,
  }).catch((error: unknown) => error);

  expect(failure).toBeInstanceOf(HistoricalWrapUnavailableError);
  expect((failure as HistoricalWrapUnavailableError).reason).toBe(
    "no-addressed-envelope",
  );
});

test("a corrupt direct envelope reports corruption, not an unreachable key", async () => {
  const parent = await createParentProjection();
  const epoch1Kek = parent.projection.containerKeks.at(-1);
  if (!epoch1Kek) {
    throw new Error("Expected the epoch-1 KEK");
  }

  const ownWrap = epoch1Kek.wraps.find(
    (wrap) =>
      wrap["recipientKind"] === "user" && wrap["recipientId"] === parent.userId,
  );
  if (!ownWrap) {
    throw new Error("Expected the requester's own epoch-1 wrap");
  }

  const failure = await recoverKeyringEntryFromWraps({
    containerId: parent.projection.containerId,
    epoch: {
      containerKeyEpoch: 1,
      containerKeyEpochId: epoch1Kek.containerKeyEpochId,
      wraps: [{ ...ownWrap, wrappedKey: "AAAA" }],
    },
    secretKey: parent.secretKey,
    userId: parent.userId,
  }).catch((error: unknown) => error);

  expect(failure).toBeInstanceOf(HistoricalWrapUnavailableError);
  expect((failure as HistoricalWrapUnavailableError).reason).toBe(
    "corrupt-envelope",
  );
});

test("an inherited-only child recovers through its parent-container wrap", async () => {
  const parent = await createParentProjection();
  const epoch1Kek = parent.projection.containerKeks.at(-1);
  if (!epoch1Kek) {
    throw new Error("Expected the epoch-1 KEK");
  }

  // A child with no direct or principal envelope of its own: its only anchor
  // at this epoch is the parent-container wrap.
  const childId = crypto.randomUUID();
  const childKey = crypto.getRandomValues(new Uint8Array(32));
  const childEpochId = await computeContainerKekMaterialId({
    containerId: childId,
    keyEpoch: 1,
    keyMaterial: childKey,
  });
  const parentKey = crypto.getRandomValues(new Uint8Array(32));
  const wrapped = await encryptWithDek(childKey, parentKey);
  const inheritedEpoch = {
    containerKeyEpoch: 1,
    containerKeyEpochId: childEpochId,
    wraps: [
      {
        containerKeyEpochId: childEpochId,
        recipientKind: "container",
        recipientId: parent.projection.containerId,
        recipientKeyEpochId: epoch1Kek.containerKeyEpochId,
        recipientKeyFingerprint: epoch1Kek.keyEpochHash,
        kemCipherText: bytesToBase64(wrapped.iv),
        wrappedKey: bytesToBase64(wrapped.ciphertext),
        wrapManifestHash: epoch1Kek.accessManifestHash,
      },
    ],
  };

  // Without the parent KEK the failure names the missing anchor precisely.
  const withoutParent = await recoverKeyringEntryFromWraps({
    containerId: childId,
    epoch: inheritedEpoch,
    secretKey: parent.secretKey,
    userId: parent.userId,
  }).catch((error: unknown) => error);
  expect(withoutParent).toBeInstanceOf(HistoricalWrapUnavailableError);
  expect((withoutParent as HistoricalWrapUnavailableError).reason).toBe(
    "parent-key-unavailable",
  );

  // With it, the child's epoch recovers and verifies against its committed id.
  const recovered = await recoverKeyringEntryFromWraps({
    containerId: childId,
    epoch: inheritedEpoch,
    parentKeysByEpochId: new Map([[epoch1Kek.containerKeyEpochId, parentKey]]),
    secretKey: parent.secretKey,
    userId: parent.userId,
  });
  expect(recovered.containerKeyEpochId).toBe(childEpochId);
  expect(recovered.keyMaterial).toEqual(childKey);
});
