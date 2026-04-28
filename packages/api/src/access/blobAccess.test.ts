import { expect, test } from "bun:test";
import { createTestUser } from "@tearleads/bob-and-alice";
import { and, eq, isNull } from "drizzle-orm";
import invariant from "invariant";
import { createDocumentFixture } from "../../test/helpers/documentFixture";
import { grantRootContainerWriteAccessToUser } from "../../test/helpers/grantContainerAccess";
import { registerUser } from "../../test/helpers/registerUser";
import { db } from "../adapters/postgres";
import { attachmentBindings, blobs, objectRecipientEnvelopes } from "../schema";
import { attachBlobToDocument, resolveBlobAccessState } from "./blobAccess";
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

function encodedByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

async function countBlobRecipientEnvelopes(blobId: string): Promise<number> {
  return (
    await db
      .select({ id: objectRecipientEnvelopes.id })
      .from(objectRecipientEnvelopes)
      .where(
        and(
          eq(objectRecipientEnvelopes.objectType, "blob"),
          eq(objectRecipientEnvelopes.objectId, blobId),
        ),
      )
  ).length;
}

async function createBlobFixture(storageKey: string): Promise<{ id: string }> {
  const [blob] = await db
    .insert(blobs)
    .values({
      byteLength: encodedByteLength(storageKey),
      encryptedBytes: storageKey,
      sha256: `${storageKey}-sha256`,
      storageKey,
    })
    .returning({ id: blobs.id });
  invariant(blob, "expected blob row");
  return blob;
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
      byteLength: encodedByteLength("blob-1-bytes"),
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
      byteLength: encodedByteLength("blob-static-recipients-bytes"),
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

test("attaching a blob replaces the active slot binding without recipient fanout", async () => {
  const alice = createTestUser();

  await registerUser(alice);

  const createdDocument = await createDocumentFixture({
    createdByFingerprint: alice.fingerprint,
    linkedContainerIds: [alice.rootContainerId],
  });
  const documentId = createdDocument.id;
  const firstBlob = await createBlobFixture("first-slot-blob");
  const secondBlob = await createBlobFixture("second-slot-blob");

  await attachBlobToDocument(firstBlob.id, documentId, "slot_replace");
  await attachBlobToDocument(secondBlob.id, documentId, "slot_replace");

  const slotBindings = await db
    .select({
      blobId: attachmentBindings.blobId,
      detachedAt: attachmentBindings.detachedAt,
      id: attachmentBindings.id,
      previousBindingId: attachmentBindings.previousBindingId,
    })
    .from(attachmentBindings)
    .where(
      and(
        eq(attachmentBindings.documentId, documentId),
        eq(attachmentBindings.slotId, "slot_replace"),
      ),
    );

  expect(slotBindings).toHaveLength(2);
  const firstBinding = slotBindings.find(
    (binding) => binding.blobId === firstBlob.id,
  );
  const secondBinding = slotBindings.find(
    (binding) => binding.blobId === secondBlob.id,
  );
  invariant(firstBinding, "expected first binding");
  invariant(secondBinding, "expected second binding");
  expect(firstBinding.detachedAt).toBeInstanceOf(Date);
  expect(secondBinding.detachedAt).toBeNull();
  expect(secondBinding.previousBindingId).toBe(firstBinding.id);

  const activeSlotBindings = await db
    .select({ blobId: attachmentBindings.blobId })
    .from(attachmentBindings)
    .where(
      and(
        eq(attachmentBindings.documentId, documentId),
        eq(attachmentBindings.slotId, "slot_replace"),
        isNull(attachmentBindings.detachedAt),
      ),
    );

  expect(activeSlotBindings).toEqual([{ blobId: secondBlob.id }]);
  expect(await countBlobRecipientEnvelopes(firstBlob.id)).toBe(0);
  expect(await countBlobRecipientEnvelopes(secondBlob.id)).toBe(0);
});
