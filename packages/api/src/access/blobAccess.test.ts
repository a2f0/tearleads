import { expect, test } from "bun:test";
import { encryptForRecipients, serializeBlobEnvelope } from "@tearleads/crypto";
import { base64ToBytes } from "@tearleads/encoding";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { createDocument } from "../../test/helpers/api/createDocument";
import { authenticate } from "../../test/helpers/authenticate";
import { createTestUser } from "../../test/helpers/createTestUser";
import { grantRootContainerWriteAccessToUser } from "../../test/helpers/grantContainerAccess";
import { registerUser } from "../../test/helpers/registerUser";
import { db } from "../adapters/postgres";
import { blobs, objectRecipientEnvelopes } from "../schema";
import {
  attachBlobToDocument,
  initializeBlobAccess,
  resolveBlobAccessState,
} from "./blobAccess";
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

async function createEncryptedBlobBytes(
  plaintext: string,
  encodedRecipientPublicKeys: string[],
): Promise<string> {
  const envelope = await encryptForRecipients(
    new TextEncoder().encode(plaintext),
    encodedRecipientPublicKeys.map((publicKey) => base64ToBytes(publicKey)),
  );

  return serializeBlobEnvelope(envelope);
}

test("blob access is derived from linked document access", async () => {
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
  const encryptedBytes = await createEncryptedBlobBytes("blob-1-bytes", [
    createdDocument.recipientEncapsulationPublicKeys[0],
  ]);

  const [blob] = await db
    .insert(blobs)
    .values({
      byteLength: new TextEncoder().encode(encryptedBytes).byteLength,
      encryptedBytes,
      sha256: "blob-1-sha256",
      storageKey: "blob-1",
    })
    .returning({ id: blobs.id });
  invariant(blob, "expected blob row");

  const blobEpoch = await attachBlobToDocument(blob.id, documentId, "slot_01");
  expect(blobEpoch).toBeGreaterThan(0);
  const initializedBlobEpoch = await initializeBlobAccess(blob.id);
  expect(initializedBlobEpoch).toBeGreaterThan(0);

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

test("initializeBlobAccess does not rewrite recipient envelopes when access is unchanged", async () => {
  const alice = createTestUser();

  await registerUser(alice);
  await authenticate(alice);

  const createDocumentResponse = await createDocument(alice.token, [
    alice.rootContainerId,
  ]);
  expect(createDocumentResponse.status).toBe(200);
  const createdDocument = await createDocumentResponse.json();
  const documentId = String(createdDocument.id ?? "");
  const encryptedBytes = await createEncryptedBlobBytes(
    "blob-static-recipients-bytes",
    createdDocument.recipientEncapsulationPublicKeys,
  );

  const [blob] = await db
    .insert(blobs)
    .values({
      byteLength: new TextEncoder().encode(encryptedBytes).byteLength,
      encryptedBytes,
      sha256: "blob-static-recipients-sha256",
      storageKey: "blob-static-recipients",
    })
    .returning({ id: blobs.id });
  invariant(blob, "expected blob row");

  const initialEpoch = await attachBlobToDocument(
    blob.id,
    documentId,
    "slot_01",
  );
  const initialEnvelopes = await db
    .select({
      id: objectRecipientEnvelopes.id,
      kemCipherText: objectRecipientEnvelopes.kemCipherText,
      wrappedKey: objectRecipientEnvelopes.wrappedKey,
    })
    .from(objectRecipientEnvelopes)
    .where(eq(objectRecipientEnvelopes.objectId, blob.id));

  expect(initialEnvelopes.length).toBeGreaterThan(0);
  expect(initialEnvelopes.every((row) => !!row.kemCipherText)).toBe(true);
  expect(initialEnvelopes.every((row) => !!row.wrappedKey)).toBe(true);

  const recomputedEpoch = await initializeBlobAccess(blob.id);
  expect(recomputedEpoch).toBe(initialEpoch);

  const recomputedEnvelopes = await db
    .select({
      id: objectRecipientEnvelopes.id,
    })
    .from(objectRecipientEnvelopes)
    .where(eq(objectRecipientEnvelopes.objectId, blob.id));

  expect(recomputedEnvelopes.map((row) => row.id)).toEqual(
    initialEnvelopes.map((row) => row.id),
  );
});
