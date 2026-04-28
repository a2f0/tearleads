import { expect, test } from "bun:test";
import { createTestUser } from "@tearleads/bob-and-alice";
import { generateKemSeedAndKeyPair, toFingerprint } from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { and, eq, isNull } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../test/helpers/authenticate";
import { createDocumentFixture } from "../../test/helpers/documentFixture";
import {
  createPrincipalStateSigner,
  createProjectionWithAdminSigner,
  signPrincipalStateBundle,
} from "../../test/helpers/principalState";
import { registerUser } from "../../test/helpers/registerUser";
import { db } from "../adapters/postgres";
import {
  containers,
  documentContainerLinks,
  groups,
  objectAccessGrants,
  objectRecipientEnvelopes,
  users,
} from "../schema";
import {
  grantContainerAccess,
  initializeContainerAccess,
  resolveContainerAccessState,
} from "./containerAccess";
import { resolveDocumentAccessState } from "./documentAccess";
import { storeVerifiedPrincipalState } from "./principalStateStore";
import type { RecipientPrincipalType } from "./recipientPrincipals";

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

async function storeCurrentGroupState(
  groupId: string,
  memberUserIds: string[],
): Promise<void> {
  const principalKem = generateKemSeedAndKeyPair();
  const signer = await createPrincipalStateSigner();
  const members = memberUserIds.map((userId) => ({
    principalType: "user" as const,
    principalId: userId,
  }));
  const projection = createProjectionWithAdminSigner(
    signer.signerUserId,
    members,
  );

  await storeVerifiedPrincipalState(
    await signPrincipalStateBundle({
      principalType: "group",
      principalId: groupId,
      version: 1,
      prevStateHash: null,
      keyEpoch: 1,
      encapsulationPublicKey: bytesToBase64(principalKem.publicKey),
      keyFingerprint: await toFingerprint(principalKem.publicKey),
      members,
      projection,
      payloadCiphertext: JSON.stringify({ members: projection }),
      signedAt: principalStateSignedAt(15),
      signerUserId: signer.signerUserId,
      signerUserKeyFingerprint: signer.signerUserKeyFingerprint,
      signingPrivateKey: signer.signingPrivateKey,
    }),
  );
}

test("document access includes recipients inherited from its linked root container", async () => {
  const alice = createTestUser();
  const bob = createTestUser();

  await registerUser(alice);
  await registerUser(bob);
  await authenticate(alice);

  const createdDocument = await createDocumentFixture({
    createdByFingerprint: alice.fingerprint,
    linkedContainerIds: [alice.rootContainerId],
  });
  const documentId = createdDocument.id;
  expect(createdDocument.currentAccessEpoch).toBe(1);

  const [aliceRow] = await db
    .select({
      defaultOrganizationId: users.defaultOrganizationId,
    })
    .from(users)
    .where(eq(users.id, alice.userId))
    .limit(1);
  invariant(aliceRow, "expected alice user row");

  const [rootContainer] = await db
    .select({
      id: containers.id,
    })
    .from(containers)
    .where(
      and(
        eq(containers.organizationId, aliceRow.defaultOrganizationId),
        isNull(containers.parentId),
      ),
    )
    .limit(1);
  invariant(rootContainer, "expected root container");

  const [link] = await db
    .select({
      containerId: documentContainerLinks.containerId,
    })
    .from(documentContainerLinks)
    .where(eq(documentContainerLinks.documentId, documentId))
    .limit(1);
  expect(link?.containerId).toBe(rootContainer.id);

  const documentEnvelopes = await db
    .select({
      id: objectRecipientEnvelopes.id,
      kemCipherText: objectRecipientEnvelopes.kemCipherText,
      wrappedKey: objectRecipientEnvelopes.wrappedKey,
    })
    .from(objectRecipientEnvelopes)
    .where(eq(objectRecipientEnvelopes.objectId, documentId));
  expect(documentEnvelopes).toHaveLength(0);

  const beforeShare = await resolveDocumentAccessState(documentId);
  invariant(beforeShare, "expected document access state");
  expect(beforeShare.currentAccessEpoch).toBe(1);
  expect(
    beforeShare.effectiveRecipients.map((recipient) => ({
      principalId: recipient.principalId,
      principalType: recipient.principalType,
    })),
  ).toEqual([userPrincipal(alice.userId)]);

  const containerEpoch = await grantContainerAccess({
    containerId: rootContainer.id,
    subjectType: "user",
    subjectId: bob.userId,
    accessLevel: "read",
  });
  expect(containerEpoch).toBeGreaterThan(1);

  const containerState = await resolveContainerAccessState(rootContainer.id);
  invariant(containerState, "expected root container access state");

  const afterShare = await resolveDocumentAccessState(documentId);
  invariant(afterShare, "expected document access state after share");
  expect(afterShare.currentAccessEpoch).toBe(containerState.currentAccessEpoch);
  const recipientPrincipals = afterShare.effectiveRecipients
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
});

test("document access can reuse caller-provided linked container state", async () => {
  const alice = createTestUser();

  await registerUser(alice);
  await authenticate(alice);

  const createdDocument = await createDocumentFixture({
    createdByFingerprint: alice.fingerprint,
    linkedContainerIds: [alice.rootContainerId],
  });
  const documentId = createdDocument.id;

  const [link] = await db
    .select({
      containerId: documentContainerLinks.containerId,
    })
    .from(documentContainerLinks)
    .where(eq(documentContainerLinks.documentId, documentId))
    .limit(1);
  invariant(link, "expected document link");

  const containerAccess = await resolveContainerAccessState(link.containerId);
  invariant(containerAccess, "expected linked container access state");

  const expectedAccess = await resolveDocumentAccessState(documentId);
  const reusedAccess = await resolveDocumentAccessState(documentId, db, {
    linkedContainerIds: [link.containerId],
    linkedContainerStateById: new Map([[link.containerId, containerAccess]]),
  });

  expect(reusedAccess).toEqual(expectedAccess);
});

test("document access includes referenced principal policy states from linked containers", async () => {
  const owner = createTestUser();
  const bob = createTestUser();
  const charlie = createTestUser();

  await registerUser(owner);
  await registerUser(bob);
  await registerUser(charlie);
  await authenticate(owner);

  const [ownerRow] = await db
    .select({
      defaultOrganizationId: users.defaultOrganizationId,
    })
    .from(users)
    .where(eq(users.id, owner.userId))
    .limit(1);
  invariant(ownerRow, "expected owner row");

  const rootAccess = await resolveContainerAccessState(owner.rootContainerId);
  invariant(rootAccess, "expected root container access state");

  const childContainerId = crypto.randomUUID();
  await db.insert(containers).values({
    id: childContainerId,
    organizationId: ownerRow.defaultOrganizationId,
    parentId: owner.rootContainerId,
  });
  await initializeContainerAccess(childContainerId, db, {
    inheritedFrom: rootAccess,
  });

  const [group] = await db
    .insert(groups)
    .values({
      organizationId: ownerRow.defaultOrganizationId,
      name: "Readers",
    })
    .returning({ id: groups.id });
  invariant(group, "expected group");

  await storeCurrentGroupState(group.id, [bob.userId, charlie.userId]);

  await grantContainerAccess({
    containerId: childContainerId,
    subjectType: "group",
    subjectId: group.id,
    accessLevel: "read",
  });

  const createdDocument = await createDocumentFixture({
    createdByFingerprint: owner.fingerprint,
    linkedContainerIds: [childContainerId],
  });

  const accessState = await resolveDocumentAccessState(createdDocument.id);
  invariant(accessState, "expected document access state");
  expect(accessState.referencedPrincipals).toEqual([
    {
      principalType: "group",
      principalId: group.id,
      version: 1,
      keyEpoch: 1,
      stateHash: expect.any(String),
    },
  ]);
});

test("document access is unavailable when a linked container has no current principal policy state", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);

  const createdDocument = await createDocumentFixture({
    createdByFingerprint: owner.fingerprint,
    linkedContainerIds: [owner.rootContainerId],
  });

  const [ownerRow] = await db
    .select({
      defaultOrganizationId: users.defaultOrganizationId,
    })
    .from(users)
    .where(eq(users.id, owner.userId))
    .limit(1);
  invariant(ownerRow, "expected owner row");

  const [group] = await db
    .insert(groups)
    .values({
      organizationId: ownerRow.defaultOrganizationId,
      name: "Unmanaged readers",
    })
    .returning({ id: groups.id });
  invariant(group, "expected group");

  await db.insert(objectAccessGrants).values({
    objectType: "container",
    objectId: owner.rootContainerId,
    subjectType: "group",
    subjectId: group.id,
    accessLevel: "read",
  });

  expect(await resolveContainerAccessState(owner.rootContainerId)).toBeNull();
  expect(await resolveDocumentAccessState(createdDocument.id)).toBeNull();
});
