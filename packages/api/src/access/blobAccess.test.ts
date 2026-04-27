import { expect, test } from "bun:test";
import { createTestUser } from "@tearleads/bob-and-alice";
import { and, eq } from "drizzle-orm";
import invariant from "invariant";
import { createDocumentFixture } from "../../test/helpers/documentFixture";
import { grantRootContainerWriteAccessToUser } from "../../test/helpers/grantContainerAccess";
import { registerUser } from "../../test/helpers/registerUser";
import { db } from "../adapters/postgres";
import { attachmentBindings, blobs, objectRecipientEnvelopes } from "../schema";
import { resolveBlobAccessState } from "./blobAccess";
import { resolveDocumentAccessState } from "./documentAccess";
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

test("blob access is derived from linked document access", async () => {
  const alice = createTestUser();
  const bob = createTestUser();

  await registerUser(alice);
  await registerUser(bob);

  const createdDocument = await createDocumentFixture({
    createdByFingerprint: alice.fingerprint,
    linkedContainerIds: [alice.rootContainerId],
  });
  const documentId = createdDocument.id;

  const [blob] = await db
    .insert(blobs)
    .values({
      byteLength: "blob-1-bytes".length,
      encryptedBytes: "blob-1-bytes",
      sha256: "blob-1-sha256",
      storageKey: "blob-1",
    })
    .returning({ id: blobs.id });
  invariant(blob, "expected blob row");

  await db.insert(attachmentBindings).values({
    blobId: blob.id,
    documentId,
    slotId: "slot_01",
  });

  const beforeShare = await resolveBlobAccessState(blob.id);
  invariant(beforeShare, "expected blob access state");
  expect(
    beforeShare.effectiveRecipients.map((recipient) => ({
      principalId: recipient.principalId,
      principalType: recipient.principalType,
    })),
  ).toEqual([userPrincipal(alice.userId)]);

  await grantRootContainerWriteAccessToUser(alice.userId, bob.userId);

  const documentState = await resolveDocumentAccessState(documentId);
  invariant(documentState, "expected document access state");

  const afterShare = await resolveBlobAccessState(blob.id);
  invariant(afterShare, "expected blob access state after share");
  expect(afterShare.currentAccessEpoch).toBe(documentState.currentAccessEpoch);
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

test("resolving blob access does not create direct recipient envelopes", async () => {
  const alice = createTestUser();

  await registerUser(alice);

  const createdDocument = await createDocumentFixture({
    createdByFingerprint: alice.fingerprint,
    linkedContainerIds: [alice.rootContainerId],
  });
  const documentId = createdDocument.id;

  const [blob] = await db
    .insert(blobs)
    .values({
      byteLength: "blob-static-recipients-bytes".length,
      encryptedBytes: "blob-static-recipients-bytes",
      sha256: "blob-static-recipients-sha256",
      storageKey: "blob-static-recipients",
    })
    .returning({ id: blobs.id });
  invariant(blob, "expected blob row");

  await db.insert(attachmentBindings).values({
    blobId: blob.id,
    documentId,
    slotId: "slot_01",
  });

  const initialEnvelopes = await db
    .select({
      id: objectRecipientEnvelopes.id,
    })
    .from(objectRecipientEnvelopes)
    .where(
      and(
        eq(objectRecipientEnvelopes.objectType, "blob"),
        eq(objectRecipientEnvelopes.objectId, blob.id),
      ),
    );

  expect(initialEnvelopes).toHaveLength(0);

  const access = await resolveBlobAccessState(blob.id);
  invariant(access, "expected blob access state");

  const recomputedEnvelopes = await db
    .select({
      id: objectRecipientEnvelopes.id,
    })
    .from(objectRecipientEnvelopes)
    .where(
      and(
        eq(objectRecipientEnvelopes.objectType, "blob"),
        eq(objectRecipientEnvelopes.objectId, blob.id),
      ),
    );

  expect(recomputedEnvelopes).toHaveLength(0);
});
