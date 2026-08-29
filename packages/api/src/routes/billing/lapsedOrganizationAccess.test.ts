import { expect, test } from "bun:test";
import { db } from "@symcrypt/api-shared/postgres";
import { organizationBilling, users } from "@symcrypt/api-shared/schema";
import { createTestUser, type TestUser } from "@symcrypt/bob-and-alice";
import {
  CONTENT_RECORD_ENCRYPTION_SUITE,
  computeContentRecordNonceDomainHash,
  computeDocumentContentRecordCiphertextHash,
  computeDocumentContentRecordMetadataHash,
  signWriteHeader,
} from "@symcrypt/crypto";
import {
  createDocument as createLoroDocument,
  encodeVersionVector,
  exportUpdatesSince,
  getUpdateVersionVectors,
} from "@symcrypt/loro";
import type { DocumentSyncRequest } from "@symcrypt/validators/request";
import {
  type DocumentCreateResponse,
  isDocumentSyncResponse,
  isOrganizationReadModelResponse,
} from "@symcrypt/validators/response";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import {
  asVerifiedContainerManifest,
  bootstrapRoot,
  createDocument,
  type StoredRootFixture,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { setTestOrganizationBillingLocal } from "../../../test/helpers/organizationBilling";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";

async function registerAndAuthenticate(user: TestUser): Promise<string> {
  await registerUser(user);
  await authenticate(user);

  const [row] = await db
    .select({ organizationId: users.defaultOrganizationId })
    .from(users)
    .where(eq(users.id, user.userId));

  invariant(row, "expected registered user row");
  return row.organizationId;
}

async function createSignedDocumentSyncRequest(input: {
  readonly created: DocumentCreateResponse;
  readonly owner: TestUser;
  readonly root: StoredRootFixture;
}): Promise<DocumentSyncRequest> {
  const updateId = crypto.randomUUID();
  const document = await createLoroDocument(`lapsed-sync-${updateId}`);
  const partialStartVersionVector = encodeVersionVector(document);
  document.getText("text").update(`lapsed sync update ${updateId}`);
  const vectors = getUpdateVersionVectors(
    exportUpdatesSince(document, partialStartVersionVector),
  );
  const encryptedData = `encrypted-lapsed-sync-update:${updateId}`;
  const plaintextHash = `plaintext-hash:${updateId}`;
  const organizationId = asVerifiedContainerManifest(input.root.bundle).state
    .organizationId;
  const writeHeader = await signWriteHeader(
    {
      version: 1,
      organizationId,
      objectKind: "document",
      objectId: input.created.id,
      accessManifestHash: input.created.contentKeyBundle.linkSetManifestHash,
      contentKeyEpoch: input.created.contentKeyBundle.contentKeyEpoch,
      targetHash: input.created.contentKeyBundle.targetHash,
      encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
      contentRecordId: updateId,
      nonceDomainHash: await computeContentRecordNonceDomainHash({
        version: 1,
        organizationId,
        objectKind: "document",
        objectId: input.created.id,
        contentKeyEpoch: input.created.contentKeyBundle.contentKeyEpoch,
        encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
        contentRecordId: updateId,
      }),
      metadataHash: await computeDocumentContentRecordMetadataHash({
        documentId: input.created.id,
        partialEndVersionVector: vectors.partialEndVersionVector,
        partialStartVersionVector: vectors.partialStartVersionVector,
        plaintextHash,
        updateId,
      }),
      ciphertextHash:
        await computeDocumentContentRecordCiphertextHash(encryptedData),
      writerUserId: input.owner.userId,
      writerDeviceId: "test-device",
      writerKeyFingerprint: input.owner.fingerprint,
      signedAt: "2026-04-27T12:00:00.000Z",
    },
    input.owner.signing.signingPrivateKey,
  );

  return {
    contentKeyEpoch: input.created.contentKeyBundle.contentKeyEpoch,
    expectedLinkSetManifestHash:
      input.created.contentKeyBundle.linkSetManifestHash,
    expectedTargetHash: input.created.contentKeyBundle.targetHash,
    authorizingContainerPathRefs: [
      [
        {
          containerId: input.root.kekState.containerId,
          manifestHash: input.root.bundle.manifestHash,
        },
      ],
    ],
    localVersionVector: null,
    outgoingUpdates: [
      {
        encryptedData,
        id: updateId,
        partialStartVersionVector: vectors.partialStartVersionVector,
        partialEndVersionVector: vectors.partialEndVersionVector,
        plaintextHash,
        writeHeader: writeHeader as unknown as Record<string, unknown>,
      },
    ],
    supportsPullPagination: true,
  };
}

test("lapsed organizations can read organization data but cannot change org profile", async () => {
  const actor = createTestUser();
  const organizationId = await registerAndAuthenticate(actor);
  await setTestOrganizationBillingLocal(organizationId);

  const readResponse = await routeApp.request(
    `/organizations/${organizationId}/read-model`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${actor.token}` },
    },
  );

  expect(readResponse.status).toBe(200);
  const readBody: unknown = await readResponse.json();
  expect(
    isOrganizationReadModelResponse(readBody) &&
      readBody.mode === "snapshot" &&
      readBody.lanes.directory.organizationId === organizationId,
  ).toBe(true);

  const writeResponse = await routeApp.request(
    `/organizations/${organizationId}/profile`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${actor.token}`,
      },
      body: JSON.stringify({ profileDocumentId: null }),
    },
  );

  expect(writeResponse.status).toBe(402);
  expect(await writeResponse.json()).toEqual({
    error: "Organization sync is not active",
    organizationId,
    reason: "billing_inactive",
  });
});

test("lapsed organizations can pull document sync but cannot push updates", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });
  const request = await createSignedDocumentSyncRequest({
    created,
    owner,
    root,
  });
  const organizationId = asVerifiedContainerManifest(root.bundle).state
    .organizationId;
  await setTestOrganizationBillingLocal(organizationId);

  const readOnlyResponse = await routeApp.request(
    `/documents/${created.id}/sync`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contentKeyEpoch: created.contentKeyBundle.contentKeyEpoch,
        expectedLinkSetManifestHash:
          created.contentKeyBundle.linkSetManifestHash,
        expectedTargetHash: created.contentKeyBundle.targetHash,
        localVersionVector: null,
        outgoingUpdates: [],
        supportsPullPagination: true,
      } satisfies DocumentSyncRequest),
    },
  );

  expect(readOnlyResponse.status).toBe(200);
  expect(isDocumentSyncResponse(await readOnlyResponse.json())).toBe(true);

  const writeResponse = await routeApp.request(
    `/documents/${created.id}/sync`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    },
  );

  expect(writeResponse.status).toBe(402);
  expect(await writeResponse.json()).toEqual({
    error: "Organization sync is not active",
    organizationId,
    reason: "billing_inactive",
  });
}, 10_000);

test("document sync rejects pulls and pushes while organization deletion is in progress", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });
  const request = await createSignedDocumentSyncRequest({
    created,
    owner,
    root,
  });
  const organizationId = asVerifiedContainerManifest(root.bundle).state
    .organizationId;
  await db
    .update(organizationBilling)
    .set({ purgeStartedAt: new Date(), status: "deleting" })
    .where(eq(organizationBilling.organizationId, organizationId));

  for (const outgoingUpdates of [[], request.outgoingUpdates]) {
    const response = await routeApp.request(`/documents/${created.id}/sync`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ...request, outgoingUpdates }),
    });
    expect(response.status).toBe(402);
    expect(await response.json()).toEqual({
      error: "Organization sync is not active",
      organizationId,
      reason: "billing_inactive",
    });
  }
}, 10_000);
