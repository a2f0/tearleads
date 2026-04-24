import { expect, test } from "bun:test";
import { createTestUser } from "@tearleads/bob-and-alice";
import { encryptForRecipients, serializeBlobEnvelope } from "@tearleads/crypto";
import { base64ToBytes } from "@tearleads/encoding";
import { and, eq, isNull } from "drizzle-orm";
import invariant from "invariant";
import { createDocument } from "../../../test/helpers/api/createDocument";
import { authenticate } from "../../../test/helpers/authenticate";
import { registerUser } from "../../../test/helpers/registerUser";
import {
  attachBlobToDocument,
  resolveBlobAccessState,
} from "../../access/blobAccess";
import { resolveDocumentAccessState } from "../../access/documentAccess";
import { db } from "../../adapters/postgres";
import { routeApp } from "../../routeApp";
import { blobs, containers, users } from "../../schema";

async function getRootContainerIdForUser(userId: string): Promise<string> {
  const [user] = await db
    .select({
      defaultOrganizationId: users.defaultOrganizationId,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  invariant(user, "expected user row");

  const [rootContainer] = await db
    .select({
      id: containers.id,
    })
    .from(containers)
    .where(
      and(
        eq(containers.organizationId, user.defaultOrganizationId),
        isNull(containers.parentId),
      ),
    )
    .limit(1);

  invariant(rootContainer, "expected root container row");
  return rootContainer.id;
}

async function createContainerForUser(input: {
  id: string;
  parentId: string;
  token: string;
}): Promise<void> {
  const response = await routeApp.request("/containers", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id: input.id,
      initialMetadataUpdates: [],
      parentId: input.parentId,
    }),
  });

  expect(response.status).toBe(200);
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

test("document link and unlink routes bump document and blob access epochs", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);

  const rootContainerId = await getRootContainerIdForUser(owner.userId);
  const siblingContainerId = crypto.randomUUID();
  await createContainerForUser({
    id: siblingContainerId,
    parentId: rootContainerId,
    token: owner.token,
  });

  const createDocumentResponse = await createDocument(owner.token, [
    rootContainerId,
  ]);
  expect(createDocumentResponse.status).toBe(200);
  const createdDocument = await createDocumentResponse.json();
  const documentId = String(createdDocument.id ?? "");
  const encryptedBytes = await createEncryptedBlobBytes(
    "blob-bytes",
    createdDocument.recipientEncapsulationPublicKeys,
  );

  const [blob] = await db
    .insert(blobs)
    .values({
      byteLength: new TextEncoder().encode(encryptedBytes).byteLength,
      encryptedBytes,
      sha256: "structural-blob-sha256",
      storageKey: "structural-blob",
    })
    .returning({ id: blobs.id });
  invariant(blob, "expected blob row");

  await attachBlobToDocument(blob.id, documentId, "slot_01");

  const linkedResponse = await routeApp.request(
    `/documents/${documentId}/link`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        containerId: siblingContainerId,
        expectedAccessStateHash: createdDocument.currentAccessStateHash,
      }),
    },
  );

  expect(linkedResponse.status).toBe(200);
  const linkedDocument = await linkedResponse.json();
  expect(linkedDocument).toEqual(
    expect.objectContaining({
      currentAccessEpoch: 2,
      id: documentId,
      linkedContainerIds: [rootContainerId, siblingContainerId].sort(),
    }),
  );

  const linkedDocumentState = await resolveDocumentAccessState(documentId);
  invariant(linkedDocumentState, "expected linked document state");
  expect(linkedDocumentState.currentAccessEpoch).toBe(2);

  const linkedBlobState = await resolveBlobAccessState(blob.id);
  invariant(linkedBlobState, "expected linked blob state");
  expect(linkedBlobState.currentAccessEpoch).toBe(2);

  const siblingListResponse = await routeApp.request(
    `/containers/${siblingContainerId}/documents`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${owner.token}`,
      },
    },
  );

  expect(siblingListResponse.status).toBe(200);
  expect(await siblingListResponse.json()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        currentAccessEpoch: 2,
        id: documentId,
        linkedContainerIds: [rootContainerId, siblingContainerId].sort(),
      }),
    ]),
  );

  const unlinkedResponse = await routeApp.request(
    `/documents/${documentId}/unlink`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        containerId: siblingContainerId,
        expectedAccessStateHash: linkedDocument.currentAccessStateHash,
      }),
    },
  );

  expect(unlinkedResponse.status).toBe(200);
  expect(await unlinkedResponse.json()).toEqual(
    expect.objectContaining({
      currentAccessEpoch: 3,
      id: documentId,
      linkedContainerIds: [rootContainerId],
    }),
  );

  const unlinkedDocumentState = await resolveDocumentAccessState(documentId);
  invariant(unlinkedDocumentState, "expected unlinked document state");
  expect(unlinkedDocumentState.currentAccessEpoch).toBe(3);

  const unlinkedBlobState = await resolveBlobAccessState(blob.id);
  invariant(unlinkedBlobState, "expected unlinked blob state");
  expect(unlinkedBlobState.currentAccessEpoch).toBe(3);

  const afterUnlinkListResponse = await routeApp.request(
    `/containers/${siblingContainerId}/documents`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${owner.token}`,
      },
    },
  );

  expect(afterUnlinkListResponse.status).toBe(200);
  expect(await afterUnlinkListResponse.json()).toEqual([]);
});

test("document unlink route rejects removing the final linked container", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);

  const createDocumentResponse = await createDocument(owner.token, [
    owner.rootContainerId,
  ]);
  expect(createDocumentResponse.status).toBe(200);
  const createdDocument = await createDocumentResponse.json();
  const documentId = String(createdDocument.id ?? "");

  const unlinkedResponse = await routeApp.request(
    `/documents/${documentId}/unlink`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        containerId: owner.rootContainerId,
        expectedAccessStateHash: createdDocument.currentAccessStateHash,
      }),
    },
  );

  expect(unlinkedResponse.status).toBe(409);
  expect(await unlinkedResponse.json()).toEqual({
    error: "Document must remain linked to at least one container",
  });
});

test("document link route rejects stale access state hashes", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);

  const rootContainerId = await getRootContainerIdForUser(owner.userId);
  const siblingContainerId = crypto.randomUUID();
  await createContainerForUser({
    id: siblingContainerId,
    parentId: rootContainerId,
    token: owner.token,
  });

  const createDocumentResponse = await createDocument(owner.token, [
    rootContainerId,
  ]);
  expect(createDocumentResponse.status).toBe(200);
  const createdDocument = await createDocumentResponse.json();
  const documentId = String(createdDocument.id ?? "");

  const linkedResponse = await routeApp.request(
    `/documents/${documentId}/link`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        containerId: siblingContainerId,
        expectedAccessStateHash: "stale-access-state-hash",
      }),
    },
  );

  expect(linkedResponse.status).toBe(409);
  expect(await linkedResponse.json()).toEqual({
    error: "Stale access state hash",
  });
});
