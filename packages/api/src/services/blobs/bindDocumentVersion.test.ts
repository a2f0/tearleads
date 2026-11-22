import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { documentUpdates } from "@tearleads/api-shared/schema";
import { mergeVersionVectors } from "@tearleads/loro";
import type { TestUser } from "@tearleads/test-utils";
import type { BlobAttachmentBindRequest } from "@tearleads/validators/request";
import { BLOB_MUTATION_ERROR_CODES } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import {
  boundBlobIds,
  commitOtherDeviceUpdate,
  documentWithRoot,
  stagedBind,
} from "../../../test/helpers/attachmentDocumentVersionKit";
import {
  bindForTest,
  blobAttachmentTestRuntime,
} from "../../../test/helpers/blobAttachmentKit";
import { committedDocumentVersionVector } from "../../../test/helpers/committedDocumentVersion";
import {
  createFirstUpdateSyncRequest,
  createSignedDocumentSyncRequest,
} from "../../../test/helpers/documentUpdateRequests";
import { routeApp } from "../../routeApp";
import { bindBlobAttachment } from "./blobMutations";

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

async function committedUpdateIds(documentId: string): Promise<string[]> {
  const rows = await db
    .select({ id: documentUpdates.id })
    .from(documentUpdates)
    .where(eq(documentUpdates.documentId, documentId));
  return rows.map((row) => row.id).sort();
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

test("a refused bind commits neither its binding nor the update it carries", async () => {
  const fixture = await documentWithRoot();
  const { blobId, request } = await stagedBind(fixture);
  const carried = await createFirstUpdateSyncRequest(fixture);
  await commitOtherDeviceUpdate(fixture);
  const before = await committedUpdateIds(fixture.document.id);

  // A carried update takes the document head for update; the version check
  // still refuses under it, and the carried update rolls back with the bind.
  await expect(
    bind(fixture.owner, blobId, { ...request, documentSync: carried.request }),
  ).rejects.toMatchObject({
    code: BLOB_MUTATION_ERROR_CODES.attachmentDocumentChanged,
    status: 409,
  });
  expect(await boundBlobIds(fixture.document.id)).toEqual([]);
  expect(await committedUpdateIds(fixture.document.id)).toEqual(before);
  expect(before).not.toContain(carried.id);
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
