import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  blobContentWriteHeaders,
  documentContentWriteHeaders,
} from "@tearleads/api-shared/schema";
import {
  CONTENT_RECORD_ENCRYPTION_SUITE,
  computeContentRecordNonceDomainHash,
  computeKeyingDomainHash,
  KeyingVerificationError,
  type WriteHeader,
} from "@tearleads/crypto";
import { createTestUser } from "@tearleads/test-utils";
import { eq } from "drizzle-orm";
import { authenticate } from "../../../../test/helpers/authenticate";
import { createSignedDocumentSyncRequest } from "../../../../test/helpers/documentUpdateRequests";
import {
  bootstrapRoot,
  createDocument,
} from "../../../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../../../test/helpers/registerUser";
import { routeApp } from "../../../routeApp";
import { storeBlobContentWriteHeader } from "./blobContentWriteHeaderStore";
import {
  createContentWriteHeaderStore,
  writeHeaderColumns,
} from "./contentKeyStore";
import { storeDocumentContentWriteHeader } from "./documentContentKeyStore";

// Other devices verify the stored header's signature; the writer keeps its
// own signed copy. A store that normalizes the header must fail the write.
const notVerbatim = new KeyingVerificationError(
  "invalid_shape",
  "Stored write header does not preserve the signed header verbatim",
);

async function hashOf(label: string): Promise<string> {
  return computeKeyingDomainHash("tearleads.keying.access-event-body", {
    label,
  });
}

/** What a store that keeps only whole seconds would hand back. */
function dropMilliseconds(header: WriteHeader): WriteHeader {
  return {
    ...header,
    signedAt: header.signedAt.replace(/\.\d{3}Z$/, "Z"),
  };
}

async function writeHeader(
  objectKind: WriteHeader["objectKind"],
  salt: string,
): Promise<{ readonly header: WriteHeader; readonly headerHash: string }> {
  const organizationId = crypto.randomUUID();
  const objectId = crypto.randomUUID();
  const contentRecordId = crypto.randomUUID();
  const header: WriteHeader = {
    dependencyManifestHashes: [],
    version: 1,
    organizationId,
    objectKind,
    objectId,
    accessManifestHash: await hashOf(`${salt}:manifest`),
    contentKeyEpoch: 1,
    targetHash: await hashOf(`${salt}:targets`),
    encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
    contentRecordId,
    nonceDomainHash: await computeContentRecordNonceDomainHash({
      version: 1,
      organizationId,
      objectKind,
      objectId,
      contentKeyEpoch: 1,
      encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
      contentRecordId,
    }),
    metadataHash: await hashOf(`${salt}:metadata`),
    ciphertextHash: await hashOf(`${salt}:ciphertext`),
    writerUserId: crypto.randomUUID(),
    writerDeviceId: "device-1",
    writerKeyFingerprint: await hashOf(`${salt}:writer`),
    signedAt: "2026-10-30T12:34:56.789Z",
    signature: `${salt}:signature`,
  };
  return { header, headerHash: await hashOf(`${salt}:${crypto.randomUUID()}`) };
}

function blobInput(signed: {
  readonly header: WriteHeader;
  readonly headerHash: string;
}) {
  return {
    authorization: {
      activeBindingIds: [],
      blobAccessManifestHash: signed.header.accessManifestHash,
      blobId: signed.header.objectId,
      blobKeyTargetHash: signed.header.targetHash,
      documentManifestHashes: [],
      linkedContainerKeyEpochIds: [],
      linkedContainerManifestHashes: [],
      organizationId: signed.header.organizationId,
      targets: [],
    },
    blobId: signed.header.objectId,
    header: signed.header,
    headerHash: signed.headerHash,
    recordId: signed.header.objectId,
  };
}

/**
 * The blob store's own insert, except the stored header loses its
 * milliseconds, as a timestamp-coercing column or driver would.
 */
const manglingBlobStore = createContentWriteHeaderStore<
  ReturnType<typeof blobInput>
>({
  createConflictError: () => new Error("conflict"),
  createObjectMismatchError: () => new Error("object mismatch"),
  expectedObjectKind: "blob",
  getObjectId: (input) => input.blobId,
  getRecordId: (input) => input.recordId,
  insert: async (input, executor) => {
    const header = dropMilliseconds(input.header);
    const [inserted] = await executor
      .insert(blobContentWriteHeaders)
      .values({
        accessManifestHash: header.accessManifestHash,
        authorization: input.authorization,
        blobId: input.blobId,
        contentKeyEpoch: header.contentKeyEpoch,
        contentRecordId: header.contentRecordId,
        encryptionSuite: header.encryptionSuite,
        header,
        headerHash: input.headerHash,
        nonceDomainHash: header.nonceDomainHash,
        organizationId: header.organizationId,
        recordId: input.recordId,
        targetHash: header.targetHash,
      })
      .onConflictDoNothing()
      .returning(writeHeaderColumns(blobContentWriteHeaders));
    return inserted ?? null;
  },
  list: async () => [],
  loadStoredHeader: async () => null,
});

test("a fresh write header insert that is not stored verbatim fails its transaction", async () => {
  const input = blobInput(await writeHeader("blob", "fresh-mangled"));

  await expect(
    db.transaction((tx) => manglingBlobStore.store(input, tx)),
  ).rejects.toMatchObject(notVerbatim);

  // The failed check rolled the insert back.
  expect(
    await db
      .select({ recordId: blobContentWriteHeaders.recordId })
      .from(blobContentWriteHeaders)
      .where(eq(blobContentWriteHeaders.recordId, input.recordId)),
  ).toEqual([]);
});

test("a blob write header retry over a non-verbatim stored header fails", async () => {
  const input = blobInput(await writeHeader("blob", "blob-retry"));
  await storeBlobContentWriteHeader(input, db);
  await db
    .update(blobContentWriteHeaders)
    .set({ header: dropMilliseconds(input.header) })
    .where(eq(blobContentWriteHeaders.recordId, input.recordId));

  await expect(storeBlobContentWriteHeader(input, db)).rejects.toMatchObject(
    notVerbatim,
  );
});

test("a document write header retry over a non-verbatim stored header fails", async () => {
  const signed = await writeHeader("document", "document-retry");
  const input = {
    authorizationTargets: [],
    documentId: signed.header.objectId,
    header: signed.header,
    headerHash: signed.headerHash,
    updateId: crypto.randomUUID(),
  };
  await storeDocumentContentWriteHeader(input, db);
  await db
    .update(documentContentWriteHeaders)
    .set({ header: dropMilliseconds(input.header) })
    .where(eq(documentContentWriteHeaders.updateId, input.updateId));

  await expect(
    storeDocumentContentWriteHeader(input, db),
  ).rejects.toMatchObject(notVerbatim);
});

test("a document sync retry over a non-verbatim stored header fails", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });
  const { request } = await createSignedDocumentSyncRequest({
    created,
    owner,
    root,
  });
  const update = request.outgoingUpdates[0];
  if (!update) throw new Error("Expected a signed outgoing update");
  const sync = () =>
    routeApp.request(`/documents/${created.id}/sync`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    });
  expect((await sync()).status).toBe(200);
  const [stored] = await db
    .select(writeHeaderColumns(documentContentWriteHeaders))
    .from(documentContentWriteHeaders)
    .where(eq(documentContentWriteHeaders.updateId, update.id));
  if (!stored) throw new Error("Expected the stored write header");
  await db
    .update(documentContentWriteHeaders)
    .set({ header: dropMilliseconds(stored.header) })
    .where(eq(documentContentWriteHeaders.updateId, update.id));

  // The retry skips the store, so the sync workflow checks the row itself.
  const retried = await sync();
  expect(retried.status).toBe(400);
  expect(await retried.json()).toMatchObject({ error: notVerbatim.message });
}, 60_000);

test("write header RETURNING rows equal their read-backs", async () => {
  const blob = blobInput(await writeHeader("blob", "blob-returning"));
  await storeBlobContentWriteHeader(blob, db);
  const [blobRead] = await db
    .select(writeHeaderColumns(blobContentWriteHeaders))
    .from(blobContentWriteHeaders)
    .where(eq(blobContentWriteHeaders.recordId, blob.recordId));
  expect(blobRead).toEqual({
    header: blob.header,
    headerHash: blob.headerHash,
  });

  const document = await writeHeader("document", "document-returning");
  const updateId = crypto.randomUUID();
  await storeDocumentContentWriteHeader(
    {
      authorizationTargets: [],
      documentId: document.header.objectId,
      ...document,
      updateId,
    },
    db,
  );
  const [documentRead] = await db
    .select(writeHeaderColumns(documentContentWriteHeaders))
    .from(documentContentWriteHeaders)
    .where(eq(documentContentWriteHeaders.updateId, updateId));
  expect(documentRead).toEqual(document);
});
