import { expect, test } from "bun:test";
import { db } from "@symcrypt/api-shared/postgres";
import type {
  ContainerKekKeyring,
  ContainerKekPredecessorBridge,
  ContainerKeyEpoch,
  ContainerKeyWrap,
  ContainerUserRecipientKey,
  VerifiedContainerAccessManifest,
  VerifiedContainerKekState,
} from "@symcrypt/crypto";
import {
  createContainerKekPredecessorBridge,
  verifyContainerKekState,
} from "@symcrypt/crypto";
import {
  createTestContainerKekKeyring,
  createTestContainerKekMaterial,
} from "../../../test/helpers/containerKekMaterial";
import {
  createContainerKekStoreManifestFixture as createContainerManifestFixture,
  containerKekStoreFixtureHash as fixtureHash,
} from "../../../test/helpers/containerKekStoreFixtures";
import {
  getContainerKeyEpochKeyring,
  getCurrentContainerKeyEpoch,
} from "../read/containerKekStore";
import { storeVerifiedContainerKekState } from "./containerKekStore";

function createContainerKeyEpochFixture(
  manifest: VerifiedContainerAccessManifest,
  keyEpoch: number,
): ContainerKeyEpoch {
  const containerKeyEpochId = manifest.state.containerKeyEpochId;

  if (!containerKeyEpochId) {
    throw new Error("Container manifest fixture is missing a key epoch id");
  }

  return {
    id: containerKeyEpochId,
    containerId: manifest.state.containerId,
    keyEpoch,
    accessManifestHash: manifest.manifestHash,
    parentContainerKeyEpochId: null,
    createdByEventHash: manifest.event.eventHash,
    createdByManifestHash: manifest.manifestHash,
  };
}

async function createContainerKeyWrap(input: {
  readonly containerKeyEpochId: string;
  readonly recipientId: string;
  readonly recipientKey: ContainerUserRecipientKey;
  readonly wrapManifestHash: string;
}): Promise<ContainerKeyWrap> {
  return {
    containerKeyEpochId: input.containerKeyEpochId,
    recipientKind: "user",
    recipientId: input.recipientId,
    recipientKeyEpochId: input.recipientKey.recipientKeyEpochId,
    recipientKeyFingerprint: input.recipientKey.recipientKeyFingerprint,
    kemCipherText: `kem:${await fixtureHash(
      `${input.recipientId}:${input.containerKeyEpochId}:kem`,
    )}`,
    wrappedKey: `wrapped:${await fixtureHash(
      `${input.recipientId}:${input.containerKeyEpochId}:wrapped`,
    )}`,
    wrapManifestHash: input.wrapManifestHash,
  };
}

interface RotationFixture {
  readonly containerId: string;
  readonly newKeyring: ContainerKekKeyring;
  readonly newKeyEpochId: string;
  readonly newState: VerifiedContainerKekState;
  readonly oldKey: Uint8Array;
  readonly oldKeyEpochId: string;
  readonly oldState: VerifiedContainerKekState;
  readonly predecessorBridge: ContainerKekPredecessorBridge;
  readonly rotatedState: (salt: string) => Promise<{
    readonly forkBridge: ContainerKekPredecessorBridge;
    readonly forkKeyring: ContainerKekKeyring;
    readonly forkState: VerifiedContainerKekState;
  }>;
}

async function createRotationFixture(): Promise<RotationFixture> {
  const containerId = crypto.randomUUID();
  const organizationId = crypto.randomUUID();
  const { containerKeyEpochId: oldKeyEpochId, plaintextKek: oldKey } =
    await createTestContainerKekMaterial({ containerId, keyEpoch: 1 });
  const { containerKeyEpochId: newKeyEpochId, plaintextKek: newKey } =
    await createTestContainerKekMaterial({ containerId, keyEpoch: 2 });
  const adminUserId = crypto.randomUUID();
  const adminKey: ContainerUserRecipientKey = {
    userId: adminUserId,
    recipientKeyEpochId: "admin-key-epoch-1",
    recipientKeyFingerprint: await fixtureHash("admin-key"),
  };
  const directGrants = [
    {
      subjectType: "user" as const,
      subjectId: adminUserId,
      accessLevel: "admin" as const,
    },
  ];
  const previousManifest = await createContainerManifestFixture({
    containerId,
    containerKeyEpochId: oldKeyEpochId,
    organizationId,
    directGrants,
    salt: "keyring-previous",
  });
  const currentManifest = await createContainerManifestFixture({
    containerId,
    containerKeyEpochId: newKeyEpochId,
    organizationId,
    epoch: 2,
    previousManifestHash: previousManifest.manifestHash,
    directGrants,
    salt: "keyring-current",
  });
  const verifyState = async (
    manifest: VerifiedContainerAccessManifest,
    keyEpoch: ContainerKeyEpoch,
  ): Promise<VerifiedContainerKekState> => {
    const state = await verifyContainerKekState({
      containerManifest: manifest,
      keyEpoch,
      userRecipientKeys: [adminKey],
      wraps: [
        await createContainerKeyWrap({
          containerKeyEpochId: keyEpoch.id,
          recipientId: adminUserId,
          recipientKey: adminKey,
          wrapManifestHash: manifest.manifestHash,
        }),
      ],
    });
    if (!state.ok) {
      throw state.error;
    }
    return state.value;
  };
  const oldState = await verifyState(
    previousManifest,
    createContainerKeyEpochFixture(previousManifest, 1),
  );
  const newState = await verifyState(
    currentManifest,
    createContainerKeyEpochFixture(currentManifest, 2),
  );
  const predecessorBridge = await createContainerKekPredecessorBridge({
    containerId,
    predecessorContainerKey: oldKey,
    predecessorContainerKeyEpochId: oldKeyEpochId,
    successorContainerKey: newKey,
    successorContainerKeyEpochId: newKeyEpochId,
  });
  const newKeyring = await createTestContainerKekKeyring({
    containerId,
    keyEpoch: 2,
    retiringContainerKey: oldKey,
    retiringContainerKeyEpochId: oldKeyEpochId,
    successorContainerKey: newKey,
    successorContainerKeyEpochId: newKeyEpochId,
  });
  const rotatedState = async (salt: string) => {
    const { containerKeyEpochId: forkKeyEpochId, plaintextKek: forkKey } =
      await createTestContainerKekMaterial({ containerId, keyEpoch: 2 });
    const forkManifest = await createContainerManifestFixture({
      containerId,
      containerKeyEpochId: forkKeyEpochId,
      organizationId,
      epoch: 2,
      previousManifestHash: previousManifest.manifestHash,
      directGrants,
      salt,
    });
    const forkState = await verifyState(
      forkManifest,
      createContainerKeyEpochFixture(forkManifest, 2),
    );
    const forkBridge = await createContainerKekPredecessorBridge({
      containerId,
      predecessorContainerKey: oldKey,
      predecessorContainerKeyEpochId: oldKeyEpochId,
      successorContainerKey: forkKey,
      successorContainerKeyEpochId: forkKeyEpochId,
    });
    const forkKeyring = await createTestContainerKekKeyring({
      containerId,
      keyEpoch: 2,
      retiringContainerKey: oldKey,
      retiringContainerKeyEpochId: oldKeyEpochId,
      successorContainerKey: forkKey,
      successorContainerKeyEpochId: forkKeyEpochId,
    });
    return { forkBridge, forkKeyring, forkState };
  };

  return {
    containerId,
    newKeyring,
    newKeyEpochId,
    newState,
    oldKey,
    oldKeyEpochId,
    oldState,
    predecessorBridge,
    rotatedState,
  };
}

async function storeRotation(fixture: RotationFixture): Promise<void> {
  await storeVerifiedContainerKekState(
    { keyring: null, predecessorBridge: null, verifiedState: fixture.oldState },
    db,
  );
  await storeVerifiedContainerKekState(
    {
      keyring: fixture.newKeyring,
      predecessorBridge: fixture.predecessorBridge,
      verifiedState: fixture.newState,
    },
    db,
  );
}

test("container KEK store persists and serves the rotation keyring", async () => {
  const fixture = await createRotationFixture();

  await storeRotation(fixture);

  // Generic epoch lookups omit the multi-megabyte keyring blob; the
  // dedicated accessor is the only reader.
  await expect(
    getCurrentContainerKeyEpoch(fixture.containerId, db),
  ).resolves.toMatchObject({
    id: fixture.newKeyEpochId,
    keyEpoch: 2,
    keyring: null,
    predecessorBridge: fixture.predecessorBridge,
  });
  await expect(
    getContainerKeyEpochKeyring(fixture.newKeyEpochId, db),
  ).resolves.toEqual(fixture.newKeyring);
});

test("container KEK store rejects a predecessor fork carrying its own keyring", async () => {
  const fixture = await createRotationFixture();
  const fork = await fixture.rotatedState("keyring-fork");

  await storeRotation(fixture);

  // The write-once predecessor edge is unique; a competing successor for the
  // same predecessor rejects regardless of its otherwise-valid artifacts.
  await expect(
    storeVerifiedContainerKekState(
      {
        keyring: fork.forkKeyring,
        predecessorBridge: fork.forkBridge,
        verifiedState: fork.forkState,
      },
      db,
    ),
  ).rejects.toThrow();
});

test("container KEK store rejects replayed epochs with tampered artifacts", async () => {
  const fixture = await createRotationFixture();

  await storeRotation(fixture);

  await expect(
    storeVerifiedContainerKekState(
      {
        keyring: fixture.newKeyring,
        predecessorBridge: {
          ...fixture.predecessorBridge,
          wrappedKey: `${fixture.predecessorBridge.wrappedKey}tampered`,
        },
        verifiedState: fixture.newState,
      },
      db,
    ),
  ).rejects.toThrow("Container key epoch conflict");
  await expect(
    storeVerifiedContainerKekState(
      {
        keyring: {
          ...fixture.newKeyring,
          sealed: `${fixture.newKeyring.sealed}tampered`,
        },
        predecessorBridge: fixture.predecessorBridge,
        verifiedState: fixture.newState,
      },
      db,
    ),
  ).rejects.toThrow("Container key epoch conflict");
});

test("container KEK store requires rotation artifacts to arrive together", async () => {
  const fixture = await createRotationFixture();

  await storeVerifiedContainerKekState(
    { keyring: null, predecessorBridge: null, verifiedState: fixture.oldState },
    db,
  );

  await expect(
    storeVerifiedContainerKekState(
      {
        keyring: null,
        predecessorBridge: fixture.predecessorBridge,
        verifiedState: fixture.newState,
      },
      db,
    ),
  ).rejects.toThrow(
    "Container key epoch rotation artifacts must be stored together",
  );
  await expect(
    storeVerifiedContainerKekState(
      {
        keyring: fixture.newKeyring,
        predecessorBridge: null,
        verifiedState: fixture.newState,
      },
      db,
    ),
  ).rejects.toThrow(
    "Container key epoch rotation artifacts must be stored together",
  );
});
