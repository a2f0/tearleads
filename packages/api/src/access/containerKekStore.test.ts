import { expect, test } from "bun:test";
import type {
  AccessManifestV2,
  ContainerDirectGrantV2,
  ContainerKeyEpochV2,
  ContainerKeyWrapV2,
  ContainerUserRecipientKeyV2,
  VerifiedAccessEvent,
  VerifiedContainerAccessManifest,
} from "@tearleads/crypto";
import {
  computeKeyingV2DomainHash,
  verifyContainerKekState,
} from "@tearleads/crypto";
import { eq } from "drizzle-orm";
import { db } from "../adapters/postgres";
import { containerKeyWraps } from "../schema";
import {
  getCurrentContainerKeyEpoch,
  listContainerKeyWraps,
  resolveStoredContainerKekState,
  storeVerifiedContainerKekState,
} from "./containerKekStore";

async function fixtureHash(label: string): Promise<string> {
  return computeKeyingV2DomainHash("tearleads.keying-v2.access-event-body.v1", {
    fixture: label,
  });
}

async function createContainerManifestFixture(input: {
  readonly containerId: string;
  readonly containerKeyEpochId: string;
  readonly directGrants: readonly ContainerDirectGrantV2[];
  readonly epoch?: number;
  readonly organizationId?: string;
  readonly previousManifestHash?: string | null;
  readonly salt?: string;
}): Promise<VerifiedContainerAccessManifest> {
  const organizationId = input.organizationId ?? crypto.randomUUID();
  const eventHash = await fixtureHash(
    `${input.salt ?? input.containerId}:event:${input.epoch ?? 1}`,
  );
  const manifest: AccessManifestV2 = {
    version: 2,
    objectKind: "container",
    objectId: input.containerId,
    organizationId,
    epoch: input.epoch ?? 1,
    previousManifestHash: input.previousManifestHash ?? null,
    eventHash,
    structuralHash: await fixtureHash(`${input.containerId}:structural`),
    grantRoot: await fixtureHash(`${input.containerId}:grant-root`),
    referencedPrincipalHeads: [],
    keyTargetHash: await fixtureHash(`${input.containerId}:key-target`),
  };
  const manifestHash = await fixtureHash(
    `${input.salt ?? input.containerId}:manifest:${input.epoch ?? 1}`,
  );

  return {
    manifest,
    manifestHash,
    event: {
      eventHash,
      event: {
        eventHash,
      },
    } as unknown as VerifiedAccessEvent,
    state: {
      version: 2,
      containerId: input.containerId,
      organizationId,
      epoch: input.epoch ?? 1,
      previousManifestHash: input.previousManifestHash ?? null,
      eventHash,
      parentContainerId: null,
      parentManifestHash: null,
      containerKeyEpochId: input.containerKeyEpochId,
      directGrants: [...input.directGrants],
      referencedPrincipalHeads: [],
    },
  } as unknown as VerifiedContainerAccessManifest;
}

async function createContainerKeyEpochFixture(input: {
  readonly createdByManifest?: VerifiedContainerAccessManifest;
  readonly keyEpoch: number;
  readonly manifest: VerifiedContainerAccessManifest;
}): Promise<ContainerKeyEpochV2> {
  const createdByManifest = input.createdByManifest ?? input.manifest;
  const containerKeyEpochId = input.manifest.state.containerKeyEpochId;

  if (!containerKeyEpochId) {
    throw new Error("Container manifest fixture is missing a key epoch id");
  }

  return {
    id: containerKeyEpochId,
    containerId: input.manifest.state.containerId,
    keyEpoch: input.keyEpoch,
    accessManifestHash: createdByManifest.manifestHash,
    parentContainerKeyEpochId: null,
    createdByEventHash: createdByManifest.event.eventHash,
    createdByManifestHash: createdByManifest.manifestHash,
  };
}

async function createContainerKeyWrap(input: {
  readonly containerKeyEpochId: string;
  readonly recipientId: string;
  readonly recipientKeyEpochId: string;
  readonly recipientKeyFingerprint: string;
  readonly wrapManifestHash: string;
}): Promise<ContainerKeyWrapV2> {
  return {
    containerKeyEpochId: input.containerKeyEpochId,
    recipientKind: "user",
    recipientId: input.recipientId,
    recipientKeyEpochId: input.recipientKeyEpochId,
    recipientKeyFingerprint: input.recipientKeyFingerprint,
    kemCipherText: `kem:${await fixtureHash(`${input.recipientId}:kem`)}`,
    wrappedKey: `wrapped:${await fixtureHash(`${input.recipientId}:wrapped`)}`,
    wrapManifestHash: input.wrapManifestHash,
  };
}

test("container KEK store persists additive wraps and resolves verified state", async () => {
  const containerId = crypto.randomUUID();
  const containerKeyEpochId = crypto.randomUUID();
  const organizationId = crypto.randomUUID();
  const originalManifest = await createContainerManifestFixture({
    containerId,
    containerKeyEpochId,
    organizationId,
    directGrants: [
      {
        subjectType: "user",
        subjectId: "alice",
        accessLevel: "read",
      },
    ],
    salt: "additive-original",
  });
  const currentManifest = await createContainerManifestFixture({
    containerId,
    containerKeyEpochId,
    organizationId,
    directGrants: [
      ...originalManifest.state.directGrants,
      {
        subjectType: "user",
        subjectId: "bob",
        accessLevel: "read",
      },
    ],
    epoch: 2,
    previousManifestHash: originalManifest.manifestHash,
    salt: "additive-current",
  });
  const aliceKey: ContainerUserRecipientKeyV2 = {
    userId: "alice",
    recipientKeyEpochId: "alice-key-epoch-1",
    recipientKeyFingerprint: await fixtureHash("alice-key"),
  };
  const bobKey: ContainerUserRecipientKeyV2 = {
    userId: "bob",
    recipientKeyEpochId: "bob-key-epoch-1",
    recipientKeyFingerprint: await fixtureHash("bob-key"),
  };
  const keyEpoch = await createContainerKeyEpochFixture({
    manifest: currentManifest,
    createdByManifest: originalManifest,
    keyEpoch: 1,
  });
  const verifiedState = await verifyContainerKekState({
    containerManifest: currentManifest,
    containerManifestHistory: [originalManifest],
    keyEpoch,
    userRecipientKeys: [aliceKey, bobKey],
    wraps: [
      await createContainerKeyWrap({
        containerKeyEpochId,
        recipientId: "alice",
        recipientKeyEpochId: aliceKey.recipientKeyEpochId,
        recipientKeyFingerprint: aliceKey.recipientKeyFingerprint,
        wrapManifestHash: originalManifest.manifestHash,
      }),
      await createContainerKeyWrap({
        containerKeyEpochId,
        recipientId: "bob",
        recipientKeyEpochId: bobKey.recipientKeyEpochId,
        recipientKeyFingerprint: bobKey.recipientKeyFingerprint,
        wrapManifestHash: currentManifest.manifestHash,
      }),
    ],
  });

  expect(verifiedState.ok).toBe(true);
  if (!verifiedState.ok) {
    throw verifiedState.error;
  }

  await storeVerifiedContainerKekState({ verifiedState: verifiedState.value });

  await expect(
    listContainerKeyWraps(containerKeyEpochId),
  ).resolves.toHaveLength(2);
  await expect(getCurrentContainerKeyEpoch(containerId)).resolves.toMatchObject(
    {
      id: containerKeyEpochId,
      keyEpoch: 1,
    },
  );
  await expect(
    resolveStoredContainerKekState({
      containerManifest: currentManifest,
      containerManifestHistory: [originalManifest],
      userRecipientKeys: [aliceKey, bobKey],
    }),
  ).resolves.toMatchObject({
    containerKeyEpochId,
    containerKeyEpoch: 1,
  });
});

test("container KEK resolver rejects tampered stored wrap fingerprints", async () => {
  const containerId = crypto.randomUUID();
  const containerKeyEpochId = crypto.randomUUID();
  const manifest = await createContainerManifestFixture({
    containerId,
    containerKeyEpochId,
    directGrants: [
      {
        subjectType: "user",
        subjectId: "alice",
        accessLevel: "read",
      },
    ],
    salt: "tamper",
  });
  const aliceKey: ContainerUserRecipientKeyV2 = {
    userId: "alice",
    recipientKeyEpochId: "alice-key-epoch-1",
    recipientKeyFingerprint: await fixtureHash("alice-key"),
  };
  const keyEpoch = await createContainerKeyEpochFixture({
    manifest,
    keyEpoch: 1,
  });
  const verifiedState = await verifyContainerKekState({
    containerManifest: manifest,
    keyEpoch,
    userRecipientKeys: [aliceKey],
    wraps: [
      await createContainerKeyWrap({
        containerKeyEpochId,
        recipientId: "alice",
        recipientKeyEpochId: aliceKey.recipientKeyEpochId,
        recipientKeyFingerprint: aliceKey.recipientKeyFingerprint,
        wrapManifestHash: manifest.manifestHash,
      }),
    ],
  });

  expect(verifiedState.ok).toBe(true);
  if (!verifiedState.ok) {
    throw verifiedState.error;
  }

  await storeVerifiedContainerKekState({ verifiedState: verifiedState.value });
  await db
    .update(containerKeyWraps)
    .set({ recipientKeyFingerprint: await fixtureHash("forged-key") })
    .where(eq(containerKeyWraps.containerKeyEpochId, containerKeyEpochId));

  await expect(
    resolveStoredContainerKekState({
      containerManifest: manifest,
      userRecipientKeys: [aliceKey],
    }),
  ).rejects.toMatchObject({ code: "hash_mismatch" });
});

test("container KEK store advances current epoch after revoke rekey", async () => {
  const containerId = crypto.randomUUID();
  const organizationId = crypto.randomUUID();
  const oldKeyEpochId = crypto.randomUUID();
  const newKeyEpochId = crypto.randomUUID();
  const previousManifest = await createContainerManifestFixture({
    containerId,
    containerKeyEpochId: oldKeyEpochId,
    organizationId,
    directGrants: [
      {
        subjectType: "user",
        subjectId: "admin",
        accessLevel: "admin",
      },
      {
        subjectType: "user",
        subjectId: "removed",
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
        subjectId: "admin",
        accessLevel: "admin",
      },
    ],
    salt: "revoke-current",
  });
  const adminKey: ContainerUserRecipientKeyV2 = {
    userId: "admin",
    recipientKeyEpochId: "admin-key-epoch-1",
    recipientKeyFingerprint: await fixtureHash("admin-key"),
  };
  const removedKey: ContainerUserRecipientKeyV2 = {
    userId: "removed",
    recipientKeyEpochId: "removed-key-epoch-1",
    recipientKeyFingerprint: await fixtureHash("removed-key"),
  };
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
        recipientId: "admin",
        recipientKeyEpochId: adminKey.recipientKeyEpochId,
        recipientKeyFingerprint: adminKey.recipientKeyFingerprint,
        wrapManifestHash: previousManifest.manifestHash,
      }),
      await createContainerKeyWrap({
        containerKeyEpochId: oldKeyEpochId,
        recipientId: "removed",
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
        recipientId: "admin",
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

  await storeVerifiedContainerKekState({ verifiedState: oldState.value });
  await storeVerifiedContainerKekState({ verifiedState: newState.value });

  await expect(getCurrentContainerKeyEpoch(containerId)).resolves.toMatchObject(
    {
      id: newKeyEpochId,
      keyEpoch: 2,
    },
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
