import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  signPrincipalState,
  toFingerprint,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { and, eq, isNull } from "drizzle-orm";
import invariant from "invariant";
import { createDocument } from "../../test/helpers/api/createDocument";
import { authenticate } from "../../test/helpers/authenticate";
import { createTestUser } from "../../test/helpers/createTestUser";
import { registerUser } from "../../test/helpers/registerUser";
import { db } from "../adapters/postgres";
import {
  containers,
  documentContainerLinks,
  groupMembers,
  groups,
  objectRecipientEnvelopes,
  users,
} from "../schema";
import {
  grantContainerAccess,
  resolveContainerAccessState,
} from "./containerAccess";
import { resolveDocumentAccessState } from "./documentAccess";
import { storeVerifiedPrincipalState } from "./principalStateStore";
import type { RecipientPrincipalType } from "./recipientPrincipals";

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
        signedAt: new Date("2026-04-08T12:15:00.000Z").toISOString(),
        signerKeyId: "group-policy-key",
      },
      signingPrivateKey,
    ),
    signingPublicKey,
  );
}

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
    .select({ id: objectRecipientEnvelopes.id })
    .from(objectRecipientEnvelopes)
    .where(eq(objectRecipientEnvelopes.objectId, documentId));
  expect(documentEnvelopes).toHaveLength(1);

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

  await db.insert(groupMembers).values([
    { groupId: group.id, userId: bob.userId },
    { groupId: group.id, userId: charlie.userId },
  ]);
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
