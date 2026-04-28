import { expect, test } from "bun:test";
import { createTestUser } from "@tearleads/bob-and-alice";
import { and, eq, isNull } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import { createContainerFixture } from "../../../test/helpers/containerFixture";
import { createDocumentFixture } from "../../../test/helpers/documentFixture";
import { registerUser } from "../../../test/helpers/registerUser";
import { resolveBlobAccessState } from "../../access/blobAccess";
import { resolveDocumentAccessState } from "../../access/documentAccess";
import { db } from "../../adapters/postgres";
import { routeApp } from "../../routeApp";
import {
  attachmentBindings,
  blobs,
  containers,
  objectAccessEpochs,
  objectRecipientEnvelopes,
  users,
} from "../../schema";

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

async function countDocumentAccessEpochs(documentId: string): Promise<number> {
  return (
    await db
      .select({ epoch: objectAccessEpochs.epoch })
      .from(objectAccessEpochs)
      .where(
        and(
          eq(objectAccessEpochs.objectType, "document"),
          eq(objectAccessEpochs.objectId, documentId),
        ),
      )
  ).length;
}

function encodedByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

test("document link and unlink routes update access state without V1 access refresh", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);

  const rootContainerId = await getRootContainerIdForUser(owner.userId);
  const siblingContainerId = crypto.randomUUID();
  await createContainerFixture({
    id: siblingContainerId,
    parentId: rootContainerId,
  });

  const createdDocument = await createDocumentFixture({
    createdByFingerprint: owner.fingerprint,
    linkedContainerIds: [rootContainerId],
  });
  const documentId = String(createdDocument.id ?? "");

  const [blob] = await db
    .insert(blobs)
    .values({
      byteLength: encodedByteLength("blob-bytes"),
      encryptedBytes: "blob-bytes",
      sha256: "structural-blob-sha256",
      storageKey: "structural-blob",
    })
    .returning({ id: blobs.id });
  invariant(blob, "expected blob row");

  await db.insert(attachmentBindings).values({
    blobId: blob.id,
    documentId,
    slotId: "slot_01",
  });
  const initialDocumentAccessEpochCount =
    await countDocumentAccessEpochs(documentId);
  const initialBlobRecipientEnvelopeCount = await countBlobRecipientEnvelopes(
    blob.id,
  );
  expect(initialDocumentAccessEpochCount).toBe(1);
  expect(initialBlobRecipientEnvelopeCount).toBe(0);

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
      currentAccessEpoch: 1,
      id: documentId,
      linkedContainerIds: [rootContainerId, siblingContainerId].sort(),
    }),
  );
  expect(linkedDocument.currentAccessStateHash).not.toBe(
    createdDocument.currentAccessStateHash,
  );
  expect(await countDocumentAccessEpochs(documentId)).toBe(
    initialDocumentAccessEpochCount,
  );

  const linkedDocumentState = await resolveDocumentAccessState(documentId);
  invariant(linkedDocumentState, "expected linked document state");
  expect(linkedDocumentState.currentAccessEpoch).toBe(1);

  const linkedBlobState = await resolveBlobAccessState(blob.id);
  invariant(linkedBlobState, "expected linked blob state");
  expect(linkedBlobState.currentAccessEpoch).toBe(1);
  expect(await countBlobRecipientEnvelopes(blob.id)).toBe(
    initialBlobRecipientEnvelopeCount,
  );

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
        currentAccessEpoch: 1,
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
      currentAccessEpoch: 1,
      currentAccessStateHash: createdDocument.currentAccessStateHash,
      id: documentId,
      linkedContainerIds: [rootContainerId],
    }),
  );
  expect(await countDocumentAccessEpochs(documentId)).toBe(
    initialDocumentAccessEpochCount,
  );

  const unlinkedDocumentState = await resolveDocumentAccessState(documentId);
  invariant(unlinkedDocumentState, "expected unlinked document state");
  expect(unlinkedDocumentState.currentAccessEpoch).toBe(1);

  const unlinkedBlobState = await resolveBlobAccessState(blob.id);
  invariant(unlinkedBlobState, "expected unlinked blob state");
  expect(unlinkedBlobState.currentAccessEpoch).toBe(1);
  expect(await countBlobRecipientEnvelopes(blob.id)).toBe(
    initialBlobRecipientEnvelopeCount,
  );

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

  const createdDocument = await createDocumentFixture({
    createdByFingerprint: owner.fingerprint,
    linkedContainerIds: [owner.rootContainerId],
  });
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
  await createContainerFixture({
    id: siblingContainerId,
    parentId: rootContainerId,
  });

  const createdDocument = await createDocumentFixture({
    createdByFingerprint: owner.fingerprint,
    linkedContainerIds: [rootContainerId],
  });
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
