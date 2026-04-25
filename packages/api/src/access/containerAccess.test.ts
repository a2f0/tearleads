import { expect, test } from "bun:test";
import { createTestUser } from "@tearleads/bob-and-alice";
import { generateKemSeedAndKeyPair, toFingerprint } from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { and, eq, sql } from "drizzle-orm";
import invariant from "invariant";
import {
  createPrincipalStateSigner,
  createProjectionWithAdminSigner,
  signPrincipalStateBundle,
} from "../../test/helpers/principalState";
import { registerUser } from "../../test/helpers/registerUser";
import { db } from "../adapters/postgres";
import {
  containers,
  groups,
  objectAccessEpochs,
  objectAccessGrants,
  users,
} from "../schema";
import {
  canReadContainerAccess,
  canWriteContainerAccess,
  grantContainerAccess,
  resolveContainerAccessState,
} from "./containerAccess";
import {
  getCurrentPrincipalState,
  storeVerifiedPrincipalState,
} from "./principalStateStore";
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

interface PrincipalStateWriter {
  principalId: string;
  principalKem: ReturnType<typeof generateKemSeedAndKeyPair>;
  principalType: "group" | "organization";
  prevStateHash: string | null;
  signerUserId: string;
  signerUserKeyFingerprint: string;
  signingPrivateKey: Uint8Array;
  version: number;
}

async function createPrincipalStateWriter(input: {
  principalId: string;
  principalType: "group" | "organization";
}): Promise<PrincipalStateWriter> {
  const principalKem = generateKemSeedAndKeyPair();
  const signer = await createPrincipalStateSigner();

  return {
    principalId: input.principalId,
    principalKem,
    principalType: input.principalType,
    prevStateHash: null,
    signerUserId: signer.signerUserId,
    signerUserKeyFingerprint: signer.signerUserKeyFingerprint,
    signingPrivateKey: signer.signingPrivateKey,
    version: 1,
  };
}

async function storePrincipalStateVersion(
  writer: PrincipalStateWriter,
  members: Array<{ principalType: "user" | "group"; principalId: string }>,
  signedAtOffsetMinutes: number,
) {
  const projection = createProjectionWithAdminSigner(
    writer.signerUserId,
    members,
  );
  const storedState = await storeVerifiedPrincipalState(
    await signPrincipalStateBundle({
      principalType: writer.principalType,
      principalId: writer.principalId,
      version: writer.version,
      prevStateHash: writer.prevStateHash,
      keyEpoch: 1,
      encapsulationPublicKey: bytesToBase64(writer.principalKem.publicKey),
      keyFingerprint: await toFingerprint(writer.principalKem.publicKey),
      members,
      projection,
      payloadCiphertext: JSON.stringify({ members: projection }),
      signedAt: principalStateSignedAt(signedAtOffsetMinutes),
      signerUserId: writer.signerUserId,
      signerUserKeyFingerprint: writer.signerUserKeyFingerprint,
      signingPrivateKey: writer.signingPrivateKey,
    }),
  );

  writer.prevStateHash = storedState.stateHash;
  writer.version += 1;

  return storedState;
}

async function storeCurrentPrincipalState(input: {
  members: Array<{ principalType: "user" | "group"; principalId: string }>;
  principalId: string;
  principalType: "group" | "organization";
  signer?: ReturnType<typeof createTestUser>;
}): Promise<void> {
  if (input.signer) {
    const principalKem = generateKemSeedAndKeyPair();
    const projection = createProjectionWithAdminSigner(
      input.signer.userId,
      input.members,
    );
    await storeVerifiedPrincipalState(
      await signPrincipalStateBundle({
        principalType: input.principalType,
        principalId: input.principalId,
        version: 1,
        prevStateHash: null,
        keyEpoch: 1,
        encapsulationPublicKey: bytesToBase64(principalKem.publicKey),
        keyFingerprint: await toFingerprint(principalKem.publicKey),
        members: input.members,
        projection,
        payloadCiphertext: JSON.stringify({ members: projection }),
        signedAt: principalStateSignedAt(0),
        signerUserId: input.signer.userId,
        signerUserKeyFingerprint: input.signer.fingerprint,
        signingPrivateKey: input.signer.signing.signingPrivateKey,
      }),
    );
    return;
  }

  await storePrincipalStateVersion(
    await createPrincipalStateWriter({
      principalId: input.principalId,
      principalType: input.principalType,
    }),
    input.members,
    0,
  );
}

async function storeNextOrganizationState(input: {
  members: Array<{ principalType: "user" | "group"; principalId: string }>;
  organizationId: string;
  signer: ReturnType<typeof createTestUser>;
}): Promise<void> {
  const currentState = await getCurrentPrincipalState(
    "organization",
    input.organizationId,
  );
  invariant(currentState, "expected current organization state");

  const projection = createProjectionWithAdminSigner(
    input.signer.userId,
    input.members,
  );
  await storeVerifiedPrincipalState(
    await signPrincipalStateBundle({
      principalType: "organization",
      principalId: input.organizationId,
      version: currentState.version + 1,
      prevStateHash: currentState.stateHash,
      keyEpoch: currentState.keyEpoch,
      encapsulationPublicKey: currentState.encapsulationPublicKey,
      keyFingerprint: currentState.keyFingerprint,
      members: input.members,
      projection,
      payloadCiphertext: JSON.stringify({ members: projection }),
      signedAt: principalStateSignedAt(0),
      signerUserId: input.signer.userId,
      signerUserKeyFingerprint: input.signer.fingerprint,
      signingPrivateKey: input.signer.signing.signingPrivateKey,
    }),
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

  await storeNextOrganizationState({
    organizationId: aliceRow.defaultOrganizationId,
    signer: alice,
    members: [
      { principalType: "user", principalId: alice.userId },
      { principalType: "user", principalId: bob.userId },
      { principalType: "user", principalId: charlie.userId },
    ],
  });
  await storeCurrentPrincipalState({
    principalType: "group",
    principalId: group.id,
    signer: bob,
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
      version: 2,
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

test("nested group policy changes bump container epoch even when crypto recipients stay stable", async () => {
  const owner = createTestUser();
  const bob = createTestUser();
  const charlie = createTestUser();

  await registerUser(owner);
  await registerUser(bob);
  await registerUser(charlie);

  const [ownerRow] = await db
    .select({
      defaultOrganizationId: users.defaultOrganizationId,
    })
    .from(users)
    .where(eq(users.id, owner.userId))
    .limit(1);
  invariant(ownerRow, "expected owner row");

  const [rootContainer] = await db
    .select({
      id: containers.id,
    })
    .from(containers)
    .where(
      and(
        eq(containers.organizationId, ownerRow.defaultOrganizationId),
        sql`${containers.parentId} is null`,
      ),
    )
    .limit(1);
  invariant(rootContainer, "expected root container");

  const [outerGroup] = await db
    .insert(groups)
    .values({
      organizationId: ownerRow.defaultOrganizationId,
      name: "Outer",
    })
    .returning({ id: groups.id });
  invariant(outerGroup, "expected outer group");

  const [innerGroup] = await db
    .insert(groups)
    .values({
      organizationId: ownerRow.defaultOrganizationId,
      name: "Inner",
    })
    .returning({ id: groups.id });
  invariant(innerGroup, "expected inner group");

  const outerWriter = await createPrincipalStateWriter({
    principalId: outerGroup.id,
    principalType: "group",
  });
  const innerWriter = await createPrincipalStateWriter({
    principalId: innerGroup.id,
    principalType: "group",
  });

  await storePrincipalStateVersion(
    innerWriter,
    [{ principalType: "user", principalId: bob.userId }],
    0,
  );
  await storePrincipalStateVersion(
    outerWriter,
    [{ principalType: "group", principalId: innerGroup.id }],
    1,
  );

  const initialEpoch = await grantContainerAccess({
    containerId: rootContainer.id,
    subjectType: "group",
    subjectId: outerGroup.id,
    accessLevel: "read",
  });

  const initialState = await resolveContainerAccessState(rootContainer.id);
  invariant(initialState, "expected initial container access state");

  await storePrincipalStateVersion(
    innerWriter,
    [
      { principalType: "user", principalId: bob.userId },
      { principalType: "user", principalId: charlie.userId },
    ],
    2,
  );

  const refreshedState = await resolveContainerAccessState(rootContainer.id);
  invariant(refreshedState, "expected refreshed container access state");

  expect(refreshedState.currentAccessEpoch).toBe(initialEpoch + 1);
  expect(refreshedState.accessFingerprint).toBe(initialState.accessFingerprint);
  expect(refreshedState.accessStateHash).not.toBe(initialState.accessStateHash);
  expect(
    refreshedState.cryptoRecipients.map((recipient) => ({
      principalId: recipient.principalId,
      principalType: recipient.principalType,
      keyFingerprint: recipient.keyFingerprint,
    })),
  ).toEqual(
    initialState.cryptoRecipients.map((recipient) => ({
      principalId: recipient.principalId,
      principalType: recipient.principalType,
      keyFingerprint: recipient.keyFingerprint,
    })),
  );
  expect(canReadContainerAccess(refreshedState, charlie.userId)).toBe(true);
  expect(refreshedState.referencedPrincipals).toEqual(
    expect.arrayContaining([
      {
        principalType: "group",
        principalId: innerGroup.id,
        version: 2,
        keyEpoch: 1,
        stateHash: expect.any(String),
      },
      {
        principalType: "group",
        principalId: outerGroup.id,
        version: 1,
        keyEpoch: 1,
        stateHash: expect.any(String),
      },
    ]),
  );
});

test("container access is unavailable when a group grant lacks current principal policy state", async () => {
  const owner = createTestUser();
  await registerUser(owner);

  const [ownerRow] = await db
    .select({
      defaultOrganizationId: users.defaultOrganizationId,
    })
    .from(users)
    .where(eq(users.id, owner.userId))
    .limit(1);
  invariant(ownerRow, "expected owner row");

  const [rootContainer] = await db
    .select({
      id: containers.id,
    })
    .from(containers)
    .where(
      and(
        eq(containers.organizationId, ownerRow.defaultOrganizationId),
        sql`${containers.parentId} is null`,
      ),
    )
    .limit(1);
  invariant(rootContainer, "expected root container");

  const [group] = await db
    .insert(groups)
    .values({
      organizationId: ownerRow.defaultOrganizationId,
      name: "Unmanaged readers",
    })
    .returning({ id: groups.id });
  invariant(group, "expected group");

  await db.insert(objectAccessGrants).values({
    objectType: CONTAINER_OBJECT_TYPE,
    objectId: rootContainer.id,
    subjectType: "group",
    subjectId: group.id,
    accessLevel: "read",
  });

  expect(await resolveContainerAccessState(rootContainer.id)).toBeNull();
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
