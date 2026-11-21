import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { attachmentBindings } from "@tearleads/api-shared/schema";
import { emptyVersionVector, mergeVersionVectors } from "@tearleads/loro";
import { createTestUser, type TestUser } from "@tearleads/test-utils";
import type { BlobAttachmentBindRequest } from "@tearleads/validators/request";
import { BLOB_MUTATION_ERROR_CODES } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import { authenticate } from "../../../test/helpers/authenticate";
import {
  bindForTest,
  blobAttachmentTestRuntime,
  buildBind,
  stageBlob,
} from "../../../test/helpers/blobAttachmentKit";
import { committedDocumentVersionVector } from "../../../test/helpers/committedDocumentVersion";
import type { CreatedDocumentFixture } from "../../../test/helpers/documentAcknowledgementFixture";
import { createSignedDocumentSyncRequest } from "../../../test/helpers/documentUpdateRequests";
import {
  bootstrapRoot,
  createDocument,
  type StoredRootFixture,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../../test/helpers/registerUser";
import { postDocumentSync } from "../../../test/helpers/staleBundleHealKit";
import { routeApp } from "../../routeApp";
import { BlobMutationError, bindBlobAttachment } from "./blobMutations";

interface Fixture {
  readonly document: CreatedDocumentFixture;
  readonly owner: TestUser;
  readonly root: StoredRootFixture;
}

async function documentWithRoot(): Promise<Fixture> {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  return { document: await createDocument({ owner, root }), owner, root };
}

/** Another device's edit: an update from a peer the uploader has not seen. */
async function commitOtherDeviceUpdate(fixture: Fixture): Promise<void> {
  const { request } = await createSignedDocumentSyncRequest({
    created: fixture.document,
    owner: fixture.owner,
    root: fixture.root,
  });
  const response = await postDocumentSync(
    fixture.owner,
    fixture.document.id,
    request,
  );
  expect(response.status).toBe(200);
}

async function stagedBind(fixture: Fixture) {
  const blobId = crypto.randomUUID();
  const { request } = await buildBind({
    blobId,
    document: fixture.document,
    owner: fixture.owner,
    root: fixture.root,
    stagedBlob: await stageBlob(fixture.owner, blobId),
  });
  return { blobId, request };
}

function bind(
  owner: TestUser,
  blobId: string,
  request: BlobAttachmentBindRequest,
) {
  return bindBlobAttachment(blobAttachmentTestRuntime, {
    blobId,
    fingerprint: owner.fingerprint,
    request,
    sessionId: "bind-document-version-test",
    userId: owner.userId,
  });
}

async function boundBlobIds(documentId: string): Promise<string[]> {
  const rows = await db
    .select({ blobId: attachmentBindings.blobId })
    .from(attachmentBindings)
    .where(eq(attachmentBindings.documentId, documentId));
  return rows.map((row) => row.blobId);
}

test("an edit committed after the uploader's check refuses the bind until it pulls", async () => {
  const fixture = await documentWithRoot();
  await commitOtherDeviceUpdate(fixture);
  const { blobId, request } = await stagedBind(fixture);
  // Another device edits after the uploader checked the slot.
  await commitOtherDeviceUpdate(fixture);

  await expect(bind(fixture.owner, blobId, request)).rejects.toMatchObject({
    code: BLOB_MUTATION_ERROR_CODES.attachmentDocumentChanged,
    status: 409,
  });
  expect(await boundBlobIds(fixture.document.id)).toEqual([]);

  // After pulling and checking the slot again, the same signed bind and its
  // kept stage commit against the newer version.
  await bind(fixture.owner, blobId, {
    ...request,
    documentVersionVector: await committedDocumentVersionVector(
      fixture.document.id,
    ),
  });
  expect(await boundBlobIds(fixture.document.id)).toEqual([blobId]);
}, 20_000);

test("a caller without access learns nothing about the document's version", async () => {
  const fixture = await documentWithRoot();
  await commitOtherDeviceUpdate(fixture);
  const outsider = await documentWithRoot();
  // The outsider signs a bind of its own bytes into its own document, then
  // names the fixture's document at a version that lacks its committed update.
  const { blobId, request } = await stagedBind(outsider);
  const stale = {
    ...request,
    body: {
      ...(request.body as Record<string, unknown>),
      documentId: fixture.document.id,
    },
    documentVersionVector: emptyVersionVector(),
  };

  const refusal = await bind(outsider.owner, blobId, stale).catch(
    (error: unknown) => error,
  );
  // Verifying the signed bind refuses it before anything reads the
  // document's updates, so the refusal never names a newer document.
  expect(refusal).toBeInstanceOf(BlobMutationError);
  expect(refusal).not.toMatchObject({
    code: BLOB_MUTATION_ERROR_CODES.attachmentDocumentChanged,
  });
}, 20_000);

test("an edit committed after the bind is never refused for it", async () => {
  const fixture = await documentWithRoot();
  const { blobId, request } = await stagedBind(fixture);
  await bindForTest({ blobId, owner: fixture.owner, request });

  // The remover planned without the binding; its edit still commits, and
  // detaching the binding is the remover's own reconciliation.
  await commitOtherDeviceUpdate(fixture);
  expect(await boundBlobIds(fixture.document.id)).toEqual([blobId]);
}, 20_000);

test("a version ahead of the server, with the uploader's unsent ops, binds", async () => {
  const fixture = await documentWithRoot();
  const { blobId, request } = await stagedBind(fixture);
  const { request: unsent } = await createSignedDocumentSyncRequest({
    created: fixture.document,
    owner: fixture.owner,
    root: fixture.root,
  });
  const localVersion = unsent.outgoingUpdates[0]?.partialEndVersionVector;
  if (!localVersion) throw new Error("Expected a local update version");

  await bind(fixture.owner, blobId, {
    ...request,
    documentVersionVector: mergeVersionVectors([
      await committedDocumentVersionVector(fixture.document.id),
      localVersion,
    ]),
  });
  expect(await boundBlobIds(fixture.document.id)).toEqual([blobId]);
}, 20_000);

test("a malformed document version is a client error", async () => {
  const fixture = await documentWithRoot();
  const { blobId, request } = await stagedBind(fixture);

  await expect(
    bind(fixture.owner, blobId, {
      ...request,
      documentVersionVector: "not a version vector",
    }),
  ).rejects.toMatchObject({ status: 400 });
  expect(await boundBlobIds(fixture.document.id)).toEqual([]);
}, 20_000);

test("a bind without a document version is refused", async () => {
  const fixture = await documentWithRoot();
  const { blobId, request } = await stagedBind(fixture);
  const { documentVersionVector: _omitted, ...withoutVersion } = request;

  const response = await routeApp.request(
    `/blobs/${blobId}/attachment-bindings`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${fixture.owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(withoutVersion),
    },
  );
  expect(response.status).toBe(400);
  expect(await boundBlobIds(fixture.document.id)).toEqual([]);
}, 20_000);
