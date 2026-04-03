import { expect, test } from "bun:test";
import invariant from "invariant";
import { createDocument } from "../../test/helpers/api/createDocument";
import { authenticate } from "../../test/helpers/authenticate";
import { createTestUser } from "../../test/helpers/createTestUser";
import { grantRootContainerWriteAccessToUser } from "../../test/helpers/grantContainerAccess";
import { registerUser } from "../../test/helpers/registerUser";
import { db } from "../adapters/postgres";
import { blobs } from "../schema";
import {
  attachBlobToDocument,
  initializeBlobAccess,
  resolveBlobAccessState,
} from "./blobAccess";
import { resolveDocumentAccessState } from "./documentAccess";

test("blob access is derived from linked document access", async () => {
  const alice = createTestUser();
  const bob = createTestUser();

  await registerUser(alice);
  await registerUser(bob);
  await authenticate(alice);

  const createDocumentResponse = await createDocument(alice.token);
  expect(createDocumentResponse.status).toBe(200);
  const createdDocument = await createDocumentResponse.json();
  const documentId = String(createdDocument.id ?? "");

  const [blob] = await db
    .insert(blobs)
    .values({
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
    beforeShare.effectiveRecipients.map((recipient) => recipient.userId),
  ).toEqual([alice.userId]);

  await grantRootContainerWriteAccessToUser(alice.userId, bob.userId);

  const documentState = await resolveDocumentAccessState(documentId);
  invariant(documentState, "expected document access state");

  const afterShare = await resolveBlobAccessState(blob.id);
  invariant(afterShare, "expected blob access state after share");
  expect(afterShare.currentAccessEpoch).toBe(documentState.currentAccessEpoch);
  const recipientUserIds = afterShare.effectiveRecipients
    .map((recipient) => recipient.userId)
    .sort((left, right) => left.localeCompare(right));
  expect(recipientUserIds).toEqual(
    [alice.userId, bob.userId].sort((left, right) => left.localeCompare(right)),
  );
});
