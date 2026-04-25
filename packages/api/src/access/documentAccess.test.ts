import { expect, test } from "bun:test";
import { createTestUser } from "@tearleads/bob-and-alice";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  signPrincipalState,
  toFingerprint,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { and, eq, isNull, sql } from "drizzle-orm";
import invariant from "invariant";
import { createDocument } from "../../test/helpers/api/createDocument";
import { authenticate } from "../../test/helpers/authenticate";
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
  resolveContainerAccessState,
} from "./containerAccess";
import {
  getDocumentRecipientEnvelopeAction,
  putDocumentRecipientEnvelopes,
  resolveDocumentAccessState,
} from "./documentAccess";
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
  const { signingPrivateKey, signingPublicKey } =
    generateSigningSeedAndKeyPair();

  await storeVerifiedPrincipalState(
    await signPrincipalState(
      {
        principalType: "group",
        principalId: groupId,
        version: 1,
        prevStateHash: null,
        keyEpoch: 1,
        encapsulationPublicKey: bytesToBase64(principalKem.publicKey),
        keyFingerprint: await toFingerprint(principalKem.publicKey),
        members: memberUserIds.map((userId) => ({
          principalType: "user",
          principalId: userId,
        })),
        signedAt: principalStateSignedAt(15),
        signerKeyId: "group-policy-key",
      },
      signingPrivateKey,
    ),
    signingPublicKey,
  );
}

test("object recipient envelopes require wrapped key material", async () => {
  let insertError: unknown;

  try {
    await db.execute(sql`
      INSERT INTO object_recipient_envelopes (
        object_type,
        object_id,
        epoch,
        recipient_principal_type,
        recipient_principal_id,
        recipient_key_fingerprint
      )
      VALUES (
        'document',
        ${crypto.randomUUID()},
        1,
        'user',
        ${crypto.randomUUID()},
        ${crypto.randomUUID()}
      )
    `);
  } catch (error) {
    insertError = error;
  }

  expect(insertError).toBeInstanceOf(Error);
});

test("document access includes recipients inherited from its linked root container", async () => {
  const alice = createTestUser();
  const bob = createTestUser();

  await registerUser(alice);
  await registerUser(bob);
  await authenticate(alice);

  const createDocumentResponse = await createDocument(alice.token, [
    alice.rootContainerId,
  ]);
  expect(createDocumentResponse.status).toBe(200);
  const createdDocument = await createDocumentResponse.json();
  const documentId = String(createdDocument.id ?? "");
  expect(createdDocument.currentAccessEpoch).toBe(1);
  expect(createdDocument.documentRecipientEnvelopes).toHaveLength(1);

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
  expect(documentEnvelopes).toHaveLength(1);
  expect(documentEnvelopes.every((row) => row.kemCipherText.length > 0)).toBe(
    true,
  );
  expect(documentEnvelopes.every((row) => row.wrappedKey.length > 0)).toBe(
    true,
  );

  const beforeShare = await resolveDocumentAccessState(documentId);
  invariant(beforeShare, "expected document access state");
  expect(beforeShare.currentAccessEpoch).toBe(1);
  await expect(
    putDocumentRecipientEnvelopes(
      crypto.randomUUID(),
      1,
      beforeShare,
      beforeShare.cryptoRecipients.map((recipient) => ({
        keyFingerprint: recipient.keyFingerprint,
        kemCipherText: "",
        wrappedKey: "wrapped-key",
      })),
    ),
  ).rejects.toThrow("Document recipient envelope is missing wrapped material");
  expect(
    await getDocumentRecipientEnvelopeAction(documentId, beforeShare),
  ).toBe("none");
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
  expect(await getDocumentRecipientEnvelopeAction(documentId, afterShare)).toBe(
    "rewrap",
  );
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

  const createDocumentResponse = await createDocument(alice.token, [
    alice.rootContainerId,
  ]);
  expect(createDocumentResponse.status).toBe(200);
  const createdDocument = await createDocumentResponse.json();
  const documentId = String(createdDocument.id ?? "");

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

  const [rootContainer] = await db
    .select({ id: containers.id })
    .from(containers)
    .where(
      and(
        eq(containers.organizationId, ownerRow.defaultOrganizationId),
        isNull(containers.parentId),
      ),
    )
    .limit(1);
  invariant(rootContainer, "expected root container");

  const [childContainer] = await db
    .insert(containers)
    .values({
      organizationId: ownerRow.defaultOrganizationId,
      parentId: rootContainer.id,
    })
    .returning({ id: containers.id });
  invariant(childContainer, "expected child container");

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
    containerId: childContainer.id,
    subjectType: "group",
    subjectId: group.id,
    accessLevel: "read",
  });

  const createDocumentResponse = await createDocument(owner.token, [
    childContainer.id,
  ]);
  expect(createDocumentResponse.status).toBe(200);
  const createdDocument = await createDocumentResponse.json();

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

  const createDocumentResponse = await createDocument(owner.token, [
    owner.rootContainerId,
  ]);
  expect(createDocumentResponse.status).toBe(200);
  const createdDocument = await createDocumentResponse.json();

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
