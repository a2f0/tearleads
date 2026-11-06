import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  createContainerKekPredecessorBridge,
  verifyContainerKekState,
} from "@tearleads/crypto";
import {
  createTestContainerKekKeyring,
  createTestContainerKekMaterial,
} from "../../../test/helpers/containerKekMaterial";
import {
  createContainerKekStoreUserKey,
  createContainerKekStoreKeyEpoch as createContainerKeyEpochFixture,
  createContainerKekStoreKeyWrap as createContainerKeyWrap,
  createContainerKekStoreManifestFixture as createContainerManifestFixture,
} from "../../../test/helpers/containerKekStoreFixtures";
import {
  getContainerKeyEpochKeyring,
  getCurrentContainerKeyEpoch,
} from "../read/containerKekStore";
import { storeVerifiedContainerKekState } from "./containerKekStore";

test("container KEK store advances a revoke rekey with its sealed keyring", async () => {
  const containerId = crypto.randomUUID();
  const organizationId = crypto.randomUUID();
  const { containerKeyEpochId: oldKeyEpochId, plaintextKek: oldKey } =
    await createTestContainerKekMaterial({
      containerId,
      keyEpoch: 1,
    });
  const { containerKeyEpochId: newKeyEpochId, plaintextKek: newKey } =
    await createTestContainerKekMaterial({
      containerId,
      keyEpoch: 2,
    });
  const adminUserId = crypto.randomUUID();
  const removedUserId = crypto.randomUUID();
  const previousManifest = await createContainerManifestFixture({
    containerId,
    containerKeyEpochId: oldKeyEpochId,
    organizationId,
    directGrants: [
      {
        subjectType: "user",
        subjectId: adminUserId,
        accessLevel: "admin",
      },
      {
        subjectType: "user",
        subjectId: removedUserId,
        accessLevel: "read",
      },
    ],
    salt: "revoke-previous",
  });
  const currentManifest = await createContainerManifestFixture({
    containerId,
    containerKeyEpochId: newKeyEpochId,
    organizationId,
    epoch: 2,
    previousManifestHash: previousManifest.manifestHash,
    directGrants: [
      {
        subjectType: "user",
        subjectId: adminUserId,
        accessLevel: "admin",
      },
    ],
    salt: "revoke-current",
  });
  const adminKey = await createContainerKekStoreUserKey(adminUserId);
  const removedKey = await createContainerKekStoreUserKey(removedUserId);
  const oldEpoch = await createContainerKeyEpochFixture({
    manifest: previousManifest,
    keyEpoch: 1,
  });
  const newEpoch = await createContainerKeyEpochFixture({
    manifest: currentManifest,
    keyEpoch: 2,
  });
  const oldState = await verifyContainerKekState({
    containerManifest: previousManifest,
    keyEpoch: oldEpoch,
    userRecipientKeys: [adminKey, removedKey],
    wraps: [
      await createContainerKeyWrap({
        containerKeyEpochId: oldKeyEpochId,
        recipientId: adminUserId,
        recipientKeyEpochId: adminKey.recipientKeyEpochId,
        recipientKeyFingerprint: adminKey.recipientKeyFingerprint,
        wrapManifestHash: previousManifest.manifestHash,
      }),
      await createContainerKeyWrap({
        containerKeyEpochId: oldKeyEpochId,
        recipientId: removedUserId,
        recipientKeyEpochId: removedKey.recipientKeyEpochId,
        recipientKeyFingerprint: removedKey.recipientKeyFingerprint,
        wrapManifestHash: previousManifest.manifestHash,
      }),
    ],
  });
  const newState = await verifyContainerKekState({
    containerManifest: currentManifest,
    keyEpoch: newEpoch,
    userRecipientKeys: [adminKey],
    wraps: [
      await createContainerKeyWrap({
        containerKeyEpochId: newKeyEpochId,
        recipientId: adminUserId,
        recipientKeyEpochId: adminKey.recipientKeyEpochId,
        recipientKeyFingerprint: adminKey.recipientKeyFingerprint,
        wrapManifestHash: currentManifest.manifestHash,
      }),
    ],
  });
  expect(oldState.ok).toBe(true);
  expect(newState.ok).toBe(true);
  if (!oldState.ok || !newState.ok) {
    throw new Error("Expected fixture states to verify");
  }
  const predecessorBridge = await createContainerKekPredecessorBridge({
    containerId,
    predecessorContainerKey: oldKey,
    predecessorContainerKeyEpochId: oldKeyEpochId,
    successorContainerKey: newKey,
    successorContainerKeyEpochId: newKeyEpochId,
  });
  const keyring = await createTestContainerKekKeyring({
    containerId,
    keyEpoch: 2,
    retiringContainerKey: oldKey,
    retiringContainerKeyEpochId: oldKeyEpochId,
    successorContainerKey: newKey,
    successorContainerKeyEpochId: newKeyEpochId,
  });

  await storeVerifiedContainerKekState(
    { keyring: null, predecessorBridge: null, verifiedState: oldState.value },
    db,
  );
  await storeVerifiedContainerKekState(
    { keyring, predecessorBridge, verifiedState: newState.value },
    db,
  );
  await expect(
    getCurrentContainerKeyEpoch(containerId, db),
  ).resolves.toMatchObject({
    id: newKeyEpochId,
    keyEpoch: 2,
    // Lookups omit the keyring blob; keyringDelivery reads it on demand.
    keyring: null,
    predecessorBridge: {
      predecessorContainerKeyEpochId: oldKeyEpochId,
      successorContainerKeyEpochId: newKeyEpochId,
    },
  });
  await expect(getContainerKeyEpochKeyring(newKeyEpochId, db)).resolves.toEqual(
    keyring,
  );
  await expect(
    verifyContainerKekState({
      containerManifest: currentManifest,
      keyEpoch: oldEpoch,
      userRecipientKeys: [adminKey, removedKey],
      wraps: oldState.value.wraps,
    }),
  ).resolves.toMatchObject({
    ok: false,
    error: { code: "key_epoch_reuse" },
  });
});
