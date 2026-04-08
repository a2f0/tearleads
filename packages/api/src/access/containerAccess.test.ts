import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  signPrincipalState,
  toFingerprint,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { and, eq, sql } from "drizzle-orm";
import invariant from "invariant";
import { createTestUser } from "../../test/helpers/createTestUser";
import { registerUser } from "../../test/helpers/registerUser";
import { db } from "../adapters/postgres";
import {
  containers,
  groupMembers,
  groups,
  objectAccessEpochs,
  objectAccessGrants,
  organizationMembers,
  users,
} from "../schema";
import {
  canReadContainerAccess,
  canWriteContainerAccess,
  resolveContainerAccessState,
} from "./containerAccess";
import { storeVerifiedPrincipalState } from "./principalStateStore";
import type { RecipientPrincipalType } from "./recipientPrincipals";

const CONTAINER_OBJECT_TYPE = "container";
const PRINCIPAL_STATE_BASE_TIME_MS = Date.UTC(2000, 0, 1, 0, 0, 0);

function principalStateSignedAt(offsetMinutes: number): string {
  return new Date(
    PRINCIPAL_STATE_BASE_TIME_MS + offsetMinutes * 60 * 1000,
  ).toISOString();
}

function userPrincipal(userId: string): {
  principalId: string;
  principalType: RecipientPrincipalType;
} {
  return {
    principalId: userId,
    principalType: "user",
  };
}

async function storeCurrentPrincipalState(input: {
  members: Array<{ principalType: "user" | "group"; principalId: string }>;
  principalId: string;
  principalType: "group" | "organization";
}): Promise<void> {
  const principalKem = generateKemSeedAndKeyPair();
  const { signingPrivateKey, signingPublicKey } =
    generateSigningSeedAndKeyPair();

  await storeVerifiedPrincipalState(
    await signPrincipalState(
      {
        principalType: input.principalType,
        principalId: input.principalId,
        version: 1,
        prevStateHash: null,
        keyEpoch: 1,
        encapsulationPublicKey: bytesToBase64(principalKem.publicKey),
        keyFingerprint: await toFingerprint(principalKem.publicKey),
        members: input.members,
        signedAt: principalStateSignedAt(0),
        signerKeyId: `${input.principalType}-policy-key`,
      },
      signingPrivateKey,
    ),
    signingPublicKey,
  );
}

test("container access inherits ancestor grants and merges child grants", async () => {
  const alice = createTestUser();
  const bob = createTestUser();

  await registerUser(alice);
  await registerUser(bob);

  const [aliceRow] = await db
    .select({
      id: users.id,
      defaultOrganizationId: users.defaultOrganizationId,
    })
    .from(users)
    .where(eq(users.id, alice.userId))
    .limit(1);

  invariant(aliceRow, "expected alice user row");

  const organizationContainers = await db
    .select({
      id: containers.id,
      parentId: containers.parentId,
    })
    .from(containers)
    .where(eq(containers.organizationId, aliceRow.defaultOrganizationId));

  const rootContainer = organizationContainers.find(
    (container) => container.parentId === null,
  );
  invariant(rootContainer, "expected root container");

  const [childContainer] = await db
    .insert(containers)
    .values({
      organizationId: aliceRow.defaultOrganizationId,
      parentId: rootContainer.id,
    })
    .returning({ id: containers.id });

  invariant(childContainer, "expected child container");

  const [grandchildContainer] = await db
    .insert(containers)
    .values({
      organizationId: aliceRow.defaultOrganizationId,
      parentId: childContainer.id,
    })
    .returning({ id: containers.id });

  invariant(grandchildContainer, "expected grandchild container");

  await db.insert(objectAccessGrants).values({
    objectType: CONTAINER_OBJECT_TYPE,
    objectId: grandchildContainer.id,
    subjectType: "user",
    subjectId: bob.userId,
    accessLevel: "read",
  });

  await db.insert(objectAccessEpochs).values({
    objectType: CONTAINER_OBJECT_TYPE,
    objectId: grandchildContainer.id,
    epoch: 1,
    accessFingerprint: "seed",
    updatedAt: new Date(),
  });

  const state = await resolveContainerAccessState(grandchildContainer.id);
  invariant(state, "expected container access state");

  expect(state.ancestorContainerIds).toEqual([
    rootContainer.id,
    childContainer.id,
    grandchildContainer.id,
  ]);
  const recipientPrincipals = state.effectiveRecipients
    .map((recipient) => ({
      principalId: recipient.principalId,
      principalType: recipient.principalType,
    }))
    .sort((left, right) => left.principalId.localeCompare(right.principalId));
  expect(recipientPrincipals).toEqual(
    [userPrincipal(alice.userId), userPrincipal(bob.userId)].sort(
      (left, right) => left.principalId.localeCompare(right.principalId),
    ),
  );
  expect(canReadContainerAccess(state, alice.userId)).toBe(true);
  expect(canReadContainerAccess(state, bob.userId)).toBe(true);
  expect(canWriteContainerAccess(state, alice.userId)).toBe(true);
  expect(canWriteContainerAccess(state, bob.userId)).toBe(false);
});

test("container access expands organization and group grants and merges access levels", async () => {
  const alice = createTestUser();
  const bob = createTestUser();
  const charlie = createTestUser();

  await registerUser(alice);
  await registerUser(bob);
  await registerUser(charlie);

  const [aliceRow] = await db
    .select({
      id: users.id,
      defaultOrganizationId: users.defaultOrganizationId,
    })
    .from(users)
    .where(eq(users.id, alice.userId))
    .limit(1);

  invariant(aliceRow, "expected alice user row");

  const organizationContainers = await db
    .select({
      id: containers.id,
      parentId: containers.parentId,
    })
    .from(containers)
    .where(eq(containers.organizationId, aliceRow.defaultOrganizationId));

  const rootContainer = organizationContainers.find(
    (container) => container.parentId === null,
  );
  invariant(rootContainer, "expected root container");

  const [childContainer] = await db
    .insert(containers)
    .values({
      organizationId: aliceRow.defaultOrganizationId,
      parentId: rootContainer.id,
    })
    .returning({ id: containers.id });

  invariant(childContainer, "expected child container");

  const [grandchildContainer] = await db
    .insert(containers)
    .values({
      organizationId: aliceRow.defaultOrganizationId,
      parentId: childContainer.id,
    })
    .returning({ id: containers.id });

  invariant(grandchildContainer, "expected grandchild container");

  const [group] = await db
    .insert(groups)
    .values({
      organizationId: aliceRow.defaultOrganizationId,
      name: "Editors",
    })
    .returning({ id: groups.id });

  invariant(group, "expected group");

  await db.insert(organizationMembers).values([
    {
      organizationId: aliceRow.defaultOrganizationId,
      userId: bob.userId,
      role: "member",
    },
    {
      organizationId: aliceRow.defaultOrganizationId,
      userId: charlie.userId,
      role: "member",
    },
  ]);

  await db.insert(groupMembers).values([
    {
      groupId: group.id,
      userId: bob.userId,
    },
    {
      groupId: group.id,
      userId: charlie.userId,
    },
  ]);

  await storeCurrentPrincipalState({
    principalType: "organization",
    principalId: aliceRow.defaultOrganizationId,
    members: [
      { principalType: "user", principalId: alice.userId },
      { principalType: "user", principalId: bob.userId },
      { principalType: "user", principalId: charlie.userId },
    ],
  });
  await storeCurrentPrincipalState({
    principalType: "group",
    principalId: group.id,
    members: [
      { principalType: "user", principalId: bob.userId },
      { principalType: "user", principalId: charlie.userId },
    ],
  });

  await db.insert(objectAccessGrants).values([
    {
      objectType: CONTAINER_OBJECT_TYPE,
      objectId: childContainer.id,
      subjectType: "organization",
      subjectId: aliceRow.defaultOrganizationId,
      accessLevel: "read",
    },
    {
      objectType: CONTAINER_OBJECT_TYPE,
      objectId: grandchildContainer.id,
      subjectType: "group",
      subjectId: group.id,
      accessLevel: "write",
    },
  ]);

  await db.insert(objectAccessEpochs).values({
    objectType: CONTAINER_OBJECT_TYPE,
    objectId: grandchildContainer.id,
    epoch: 1,
    accessFingerprint: "seed",
    updatedAt: new Date(),
  });

  const state = await resolveContainerAccessState(grandchildContainer.id);
  invariant(state, "expected container access state");

  const recipientPrincipals = state.effectiveRecipients
    .map((recipient) => ({
      principalId: recipient.principalId,
      principalType: recipient.principalType,
    }))
    .sort((left, right) => left.principalId.localeCompare(right.principalId));
  expect(recipientPrincipals).toEqual(
    [
      userPrincipal(alice.userId),
      userPrincipal(bob.userId),
      userPrincipal(charlie.userId),
    ].sort((left, right) => left.principalId.localeCompare(right.principalId)),
  );

  expect(canReadContainerAccess(state, alice.userId)).toBe(true);
  expect(canWriteContainerAccess(state, alice.userId)).toBe(true);
  expect(canReadContainerAccess(state, bob.userId)).toBe(true);
  expect(canWriteContainerAccess(state, bob.userId)).toBe(true);
  expect(canReadContainerAccess(state, charlie.userId)).toBe(true);
  expect(canWriteContainerAccess(state, charlie.userId)).toBe(true);

  const bobRecipient = state.effectiveRecipients.find(
    (recipient) => recipient.principalId === bob.userId,
  );
  const charlieRecipient = state.effectiveRecipients.find(
    (recipient) => recipient.principalId === charlie.userId,
  );

  expect(bobRecipient?.accessLevel).toBe("write");
  expect(charlieRecipient?.accessLevel).toBe("write");
  expect(state.referencedPrincipals).toEqual([
    {
      principalType: "group",
      principalId: group.id,
      version: 1,
      keyEpoch: 1,
      stateHash: expect.any(String),
    },
    {
      principalType: "organization",
      principalId: aliceRow.defaultOrganizationId,
      version: 1,
      keyEpoch: 1,
      stateHash: expect.any(String),
    },
  ]);

  // A user who is not a member of the org or group should not have access
  const outsider = createTestUser();
  await registerUser(outsider);

  expect(canReadContainerAccess(state, outsider.userId)).toBe(false);
  expect(canWriteContainerAccess(state, outsider.userId)).toBe(false);
  expect(
    state.effectiveRecipients.find(
      (recipient) => recipient.principalId === outsider.userId,
    ),
  ).toBeUndefined();
});

test("container access uses stored recipient key fingerprints", async () => {
  const alice = createTestUser();
  const bob = createTestUser();

  await registerUser(alice);
  await registerUser(bob);

  const [aliceRow] = await db
    .select({
      defaultOrganizationId: users.defaultOrganizationId,
    })
    .from(users)
    .where(eq(users.id, alice.userId))
    .limit(1);

  invariant(aliceRow, "expected alice user row");

  const [rootContainer] = await db
    .select({ id: containers.id })
    .from(containers)
    .where(
      and(
        eq(containers.organizationId, aliceRow.defaultOrganizationId),
        sql`${containers.parentId} is null`,
      ),
    )
    .limit(1);

  invariant(rootContainer, "expected root container");

  const persistedFingerprint = "persisted-recipient-key-fingerprint";

  await db
    .update(users)
    .set({
      encapsulationPublicKey: "not-base64-anymore",
      encapsulationKeyFingerprint: persistedFingerprint,
    })
    .where(eq(users.id, bob.userId));

  await db.insert(objectAccessGrants).values({
    objectType: CONTAINER_OBJECT_TYPE,
    objectId: rootContainer.id,
    subjectType: "user",
    subjectId: bob.userId,
    accessLevel: "read",
  });

  const state = await resolveContainerAccessState(rootContainer.id);
  invariant(state, "expected container access state");

  const bobRecipient = state.effectiveRecipients.find(
    (recipient) => recipient.principalId === bob.userId,
  );

  expect(bobRecipient?.keyFingerprint).toBe(persistedFingerprint);
});
