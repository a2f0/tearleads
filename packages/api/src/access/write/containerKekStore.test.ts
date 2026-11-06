import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { containerKeyWraps } from "@tearleads/api-shared/schema";
import type {
  ContainerDirectGrant,
  ReferencedPrincipalHead,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import {
  derivePrincipalRecipientKeyEpochId,
  verifyContainerKekState,
} from "@tearleads/crypto";
import { eq } from "drizzle-orm";
import { createTestContainerKekMaterial } from "../../../test/helpers/containerKekMaterial";
import {
  createContainerKekStoreUserKey,
  createContainerKekStoreKeyEpoch as createContainerKeyEpochFixture,
  createContainerKekStoreKeyWrap as createContainerKeyWrap,
  createContainerKekStoreManifestFixture as createContainerManifestFixture,
  containerKekStoreFixtureHash as fixtureHash,
} from "../../../test/helpers/containerKekStoreFixtures";
import {
  getCurrentContainerKeyEpoch,
  listContainerKeyWraps,
  resolveStoredContainerKekState,
} from "../read/containerKekStore";
import { storeVerifiedContainerKekState } from "./containerKekStore";

async function principalHeadFixture(input: {
  readonly keyEpoch: number;
  readonly principalId: string;
  readonly version: number;
}): Promise<ReferencedPrincipalHead> {
  return {
    principalType: "group",
    principalId: input.principalId,
    version: input.version,
    keyEpoch: input.keyEpoch,
    stateHash: await fixtureHash(`${input.principalId}:state:${input.version}`),
    keyFingerprint: await fixtureHash(
      `${input.principalId}:key:${input.keyEpoch}`,
    ),
  };
}

function principalPolicyFixture(
  head: ReferencedPrincipalHead,
): VerifiedPrincipalPolicy {
  return {
    principalType: head.principalType,
    principalId: head.principalId,
    version: head.version,
    keyEpoch: head.keyEpoch,
    stateHash: head.stateHash,
    state: {
      keyFingerprint: head.keyFingerprint,
    },
    projection: [],
    checkpoint: {
      principalType: head.principalType,
      principalId: head.principalId,
      version: head.version,
      stateHash: head.stateHash,
    },
  } as unknown as VerifiedPrincipalPolicy;
}

test("container KEK store persists additive wraps and resolves verified state", async () => {
  const containerId = crypto.randomUUID();
  const { containerKeyEpochId } = await createTestContainerKekMaterial({
    containerId,
    keyEpoch: 1,
  });
  const organizationId = crypto.randomUUID();
  const aliceUserId = crypto.randomUUID();
  const bobUserId = crypto.randomUUID();
  const originalManifest = await createContainerManifestFixture({
    containerId,
    containerKeyEpochId,
    organizationId,
    directGrants: [
      {
        subjectType: "user",
        subjectId: aliceUserId,
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
        subjectId: bobUserId,
        accessLevel: "read",
      },
    ],
    epoch: 2,
    previousManifestHash: originalManifest.manifestHash,
    salt: "additive-current",
  });
  const aliceKey = await createContainerKekStoreUserKey(aliceUserId);
  const bobKey = await createContainerKekStoreUserKey(bobUserId);
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
        recipientId: aliceUserId,
        recipientKeyEpochId: aliceKey.recipientKeyEpochId,
        recipientKeyFingerprint: aliceKey.recipientKeyFingerprint,
        wrapManifestHash: originalManifest.manifestHash,
      }),
      await createContainerKeyWrap({
        containerKeyEpochId,
        recipientId: bobUserId,
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

  await storeVerifiedContainerKekState(
    {
      keyring: null,
      predecessorBridge: null,
      verifiedState: verifiedState.value,
    },
    db,
  );

  await expect(
    listContainerKeyWraps(containerKeyEpochId, db),
  ).resolves.toHaveLength(2);
  await expect(
    getCurrentContainerKeyEpoch(containerId, db),
  ).resolves.toMatchObject({
    id: containerKeyEpochId,
    keyEpoch: 1,
  });
  await expect(
    resolveStoredContainerKekState(
      {
        containerManifest: currentManifest,
        containerManifestHistory: [originalManifest],
        userRecipientKeys: [aliceKey, bobKey],
      },
      db,
    ),
  ).resolves.toMatchObject({
    containerKeyEpochId,
    containerKeyEpoch: 1,
  });
});

test("container KEK store replaces stale same-epoch principal wraps", async () => {
  const containerId = crypto.randomUUID();
  const { containerKeyEpochId } = await createTestContainerKekMaterial({
    containerId,
    keyEpoch: 1,
  });
  const organizationId = crypto.randomUUID();
  const groupId = crypto.randomUUID();
  const initialGroupHead = await principalHeadFixture({
    principalId: groupId,
    version: 1,
    keyEpoch: 1,
  });
  const rotatedGroupHead = await principalHeadFixture({
    principalId: groupId,
    version: 1,
    keyEpoch: 2,
  });
  const grant: ContainerDirectGrant = {
    subjectType: "group",
    subjectId: groupId,
    accessLevel: "read",
  };
  const originalManifest = await createContainerManifestFixture({
    containerId,
    containerKeyEpochId,
    organizationId,
    directGrants: [grant],
    referencedPrincipalHeads: [initialGroupHead],
    salt: "principal-wrap-original",
  });
  const currentManifest = await createContainerManifestFixture({
    containerId,
    containerKeyEpochId,
    organizationId,
    directGrants: [grant],
    epoch: 2,
    previousManifestHash: originalManifest.manifestHash,
    referencedPrincipalHeads: [rotatedGroupHead],
    salt: "principal-wrap-current",
  });
  const keyEpoch = await createContainerKeyEpochFixture({
    manifest: currentManifest,
    createdByManifest: originalManifest,
    keyEpoch: 1,
  });
  const initialWrap = await createContainerKeyWrap({
    containerKeyEpochId,
    recipientKind: "group",
    recipientId: groupId,
    recipientKeyEpochId: derivePrincipalRecipientKeyEpochId(initialGroupHead),
    recipientKeyFingerprint: initialGroupHead.keyFingerprint,
    wrapManifestHash: originalManifest.manifestHash,
  });
  const rotatedWrap = await createContainerKeyWrap({
    containerKeyEpochId,
    recipientKind: "group",
    recipientId: groupId,
    recipientKeyEpochId: derivePrincipalRecipientKeyEpochId(rotatedGroupHead),
    recipientKeyFingerprint: rotatedGroupHead.keyFingerprint,
    wrapManifestHash: currentManifest.manifestHash,
  });
  const initialState = await verifyContainerKekState({
    containerManifest: originalManifest,
    keyEpoch,
    principalPolicies: [principalPolicyFixture(initialGroupHead)],
    wraps: [initialWrap],
  });
  const currentState = await verifyContainerKekState({
    containerManifest: currentManifest,
    containerManifestHistory: [originalManifest],
    keyEpoch,
    principalPolicies: [principalPolicyFixture(rotatedGroupHead)],
    wraps: [rotatedWrap],
  });

  expect(initialState.ok).toBe(true);
  expect(currentState.ok).toBe(true);
  if (!initialState.ok || !currentState.ok) {
    throw new Error("Expected fixture states to verify");
  }

  await storeVerifiedContainerKekState(
    {
      keyring: null,
      predecessorBridge: null,
      verifiedState: initialState.value,
    },
    db,
  );
  await storeVerifiedContainerKekState(
    {
      keyring: null,
      predecessorBridge: null,
      verifiedState: currentState.value,
    },
    db,
  );

  await expect(listContainerKeyWraps(containerKeyEpochId, db)).resolves.toEqual(
    [
      expect.objectContaining({
        recipientKind: "group",
        recipientId: groupId,
        recipientKeyEpochId:
          derivePrincipalRecipientKeyEpochId(rotatedGroupHead),
        recipientKeyFingerprint: rotatedGroupHead.keyFingerprint,
      }),
    ],
  );
  await expect(
    resolveStoredContainerKekState(
      {
        containerManifest: currentManifest,
        containerManifestHistory: [originalManifest],
        principalPolicies: [principalPolicyFixture(rotatedGroupHead)],
      },
      db,
    ),
  ).resolves.toMatchObject({
    containerKeyEpochId,
    recipientTargets: [
      {
        recipientKind: "group",
        recipientId: groupId,
        recipientKeyEpochId:
          derivePrincipalRecipientKeyEpochId(rotatedGroupHead),
        recipientKeyFingerprint: rotatedGroupHead.keyFingerprint,
      },
    ],
  });
});

test("container KEK resolver rejects tampered stored wrap fingerprints", async () => {
  const containerId = crypto.randomUUID();
  const { containerKeyEpochId } = await createTestContainerKekMaterial({
    containerId,
    keyEpoch: 1,
  });
  const aliceUserId = crypto.randomUUID();
  const manifest = await createContainerManifestFixture({
    containerId,
    containerKeyEpochId,
    directGrants: [
      {
        subjectType: "user",
        subjectId: aliceUserId,
        accessLevel: "read",
      },
    ],
    salt: "tamper",
  });
  const aliceKey = await createContainerKekStoreUserKey(aliceUserId);
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
        recipientId: aliceUserId,
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

  await storeVerifiedContainerKekState(
    {
      keyring: null,
      predecessorBridge: null,
      verifiedState: verifiedState.value,
    },
    db,
  );
  await db
    .update(containerKeyWraps)
    .set({ recipientKeyFingerprint: await fixtureHash("forged-key") })
    .where(eq(containerKeyWraps.containerKeyEpochId, containerKeyEpochId));

  await expect(
    resolveStoredContainerKekState(
      {
        containerManifest: manifest,
        userRecipientKeys: [aliceKey],
      },
      db,
    ),
  ).rejects.toMatchObject({ code: "hash_mismatch" });
});
