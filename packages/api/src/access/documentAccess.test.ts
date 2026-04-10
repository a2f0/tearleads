import { expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
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
import { createTestUser } from "../../test/helpers/createTestUser";
import { registerUser } from "../../test/helpers/registerUser";
import { db, postgresBootstrapSql } from "../adapters/postgres";
import {
  containers,
  documentContainerLinks,
  groupMembers,
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

test("postgres bootstrap tightens legacy object recipient envelope tables", async () => {
  const legacyClient = new PGlite({ debug: 0 });

  try {
    await legacyClient.exec(`
      CREATE TABLE object_recipient_envelopes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        object_type TEXT NOT NULL,
        object_id TEXT NOT NULL,
        epoch INTEGER NOT NULL,
        recipient_principal_type TEXT NOT NULL,
        recipient_principal_id TEXT NOT NULL,
        recipient_key_fingerprint TEXT NOT NULL,
        kem_cipher_text TEXT,
        wrapped_key TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT now()
      );
      INSERT INTO object_recipient_envelopes (
        object_type,
        object_id,
        epoch,
        recipient_principal_type,
        recipient_principal_id,
        recipient_key_fingerprint,
        kem_cipher_text,
        wrapped_key
      )
      VALUES
        ('document', 'legacy-missing-material', 1, 'user', 'user-1', 'key-1', NULL, NULL),
        ('document', 'legacy-valid-material', 1, 'user', 'user-2', 'key-2', 'kem', 'wrapped');
    `);

    await legacyClient.exec(postgresBootstrapSql);

    const remainingRows = await legacyClient.query<{
      kem_cipher_text: string;
      object_id: string;
      wrapped_key: string;
    }>(`
      SELECT object_id, kem_cipher_text, wrapped_key
      FROM object_recipient_envelopes
      ORDER BY object_id
    `);
    expect(remainingRows.rows).toEqual([
      {
        kem_cipher_text: "kem",
        object_id: "legacy-valid-material",
        wrapped_key: "wrapped",
      },
    ]);

    let insertError: unknown;
    try {
      await legacyClient.exec(`
        INSERT INTO object_recipient_envelopes (
          object_type,
          object_id,
          epoch,
          recipient_principal_type,
          recipient_principal_id,
          recipient_key_fingerprint
        )
        VALUES ('document', 'post-bootstrap-missing-material', 1, 'user', 'user-3', 'key-3')
      `);
    } catch (error) {
      insertError = error;
    }

    expect(insertError).toBeInstanceOf(Error);
  } finally {
    await legacyClient.close();
  }
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
