import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { attachmentBindings } from "@tearleads/api-shared/schema";
import type { VerifiedAttachmentBinding } from "@tearleads/crypto";
import { mergeVersionVectors } from "@tearleads/loro";
import { BLOB_MUTATION_ERROR_CODES } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import {
  activeBoundBlobIds,
  commitOtherDeviceUpdate,
  type DocumentVersionFixture,
  documentWithRoot,
  stagedBind,
} from "../../../test/helpers/attachmentDocumentVersionKit";
import {
  bindForTest,
  buildDetach,
  detachForTest,
} from "../../../test/helpers/blobAttachmentKit";
import { committedDocumentVersionVector } from "../../../test/helpers/committedDocumentVersion";
import { createSignedDocumentSyncRequest } from "../../../test/helpers/documentUpdateRequests";
import { postDocumentSync } from "../../../test/helpers/staleBundleHealKit";
import { routeApp } from "../../routeApp";

async function boundAtCommittedVersion(fixture: DocumentVersionFixture) {
  const bound = await stagedBind(fixture);
  await bindForTest({
    blobId: bound.blobId,
    owner: fixture.owner,
    request: bound.request,
  });
  return bound;
}

async function detach(
  fixture: DocumentVersionFixture,
  binding: VerifiedAttachmentBinding,
  documentVersionVector?: string,
  processedThroughUpdateId?: string,
) {
  const request = await buildDetach({
    binding,
    document: fixture.document,
    owner: fixture.owner,
    root: fixture.root,
  });
  await detachForTest({
    binding,
    blobId: binding.blobId,
    owner: fixture.owner,
    request: {
      ...request,
      documentVersionVector:
        documentVersionVector ?? request.documentVersionVector,
      ...(processedThroughUpdateId === undefined
        ? {}
        : { processedThroughUpdateId }),
    },
  });
}

const documentChanged = {
  code: BLOB_MUTATION_ERROR_CODES.attachmentDocumentChanged,
  status: 409,
};

test("a detach behind a committed edit is refused until it pulls", async () => {
  const fixture = await documentWithRoot();
  const { binding, blobId } = await boundAtCommittedVersion(fixture);
  const readRemoved = await committedDocumentVersionVector(fixture.document.id);
  // Another device commits after the detaching device read the slot removed;
  // it may have restored the slot with these bytes.
  await commitOtherDeviceUpdate(fixture);

  await expect(detach(fixture, binding, readRemoved)).rejects.toMatchObject(
    documentChanged,
  );
  expect(await activeBoundBlobIds(fixture.document.id)).toEqual([blobId]);

  // After pulling, the slot is still removed at the newer version.
  await detach(fixture, binding);
  expect(await activeBoundBlobIds(fixture.document.id)).toEqual([]);
}, 20_000);

test("a binding bound with its uploader's unsent op keeps it until that op is read", async () => {
  const fixture = await documentWithRoot();
  const { binding, blobId, request } = await stagedBind(fixture);
  // The uploader binds before pushing the update that records its slot.
  const { request: unsent } = await createSignedDocumentSyncRequest({
    created: fixture.document,
    owner: fixture.owner,
    root: fixture.root,
  });
  const localVersion = unsent.outgoingUpdates[0]?.partialEndVersionVector;
  if (!localVersion) throw new Error("Expected a local update version");
  await bindForTest({
    blobId,
    owner: fixture.owner,
    request: {
      ...request,
      documentVersionVector: mergeVersionVectors([
        request.documentVersionVector,
        localVersion,
      ]),
    },
  });
  const [stored] = await db
    .select({ version: attachmentBindings.bindDocumentVersion })
    .from(attachmentBindings)
    .where(eq(attachmentBindings.id, binding.bindingId));
  expect(JSON.parse(stored?.version ?? "[]")).not.toEqual([]);

  // Every committed op is read, but the slot's restore is still on its way.
  await expect(detach(fixture, binding)).rejects.toMatchObject(documentChanged);
  expect(await activeBoundBlobIds(fixture.document.id)).toEqual([blobId]);

  const response = await postDocumentSync(
    fixture.owner,
    fixture.document.id,
    unsent,
  );
  expect(response.status).toBe(200);
  await detach(fixture, binding);
  expect(await activeBoundBlobIds(fixture.document.id)).toEqual([]);
}, 20_000);

test("a bind version naming an op the detaching client voided does not hold the binding", async () => {
  const fixture = await documentWithRoot();
  const readRemoved = await committedDocumentVersionVector(fixture.document.id);
  // Another device commits an update the detaching client voids, so no
  // version it reads holds that update's ops. The uploader bound at a version
  // naming them, as a dishonest uploader may name any committed counter.
  const { request: voided, updateId } = await createSignedDocumentSyncRequest({
    created: fixture.document,
    owner: fixture.owner,
    root: fixture.root,
  });
  const response = await postDocumentSync(
    fixture.owner,
    fixture.document.id,
    voided,
  );
  expect(response.status).toBe(200);
  const { binding } = await boundAtCommittedVersion(fixture);

  // The detaching client judged that update, so its cursor names it, and
  // read the slot removed at a version without its ops.
  await detach(fixture, binding, readRemoved, updateId);
  expect(await activeBoundBlobIds(fixture.document.id)).toEqual([]);
}, 20_000);

test("a malformed detach version is a client error", async () => {
  const fixture = await documentWithRoot();
  const { binding, blobId } = await boundAtCommittedVersion(fixture);

  await expect(
    detach(fixture, binding, "not a version vector"),
  ).rejects.toMatchObject({ status: 400 });
  expect(await activeBoundBlobIds(fixture.document.id)).toEqual([blobId]);
}, 20_000);

test("the detach route names a refused version's code for the client to pull", async () => {
  const fixture = await documentWithRoot();
  const { binding, blobId } = await boundAtCommittedVersion(fixture);
  const readRemoved = await committedDocumentVersionVector(fixture.document.id);
  await commitOtherDeviceUpdate(fixture);
  const request = await buildDetach({
    binding,
    document: fixture.document,
    owner: fixture.owner,
    root: fixture.root,
  });

  const response = await routeApp.request(
    `/blobs/${blobId}/attachment-bindings/${binding.bindingId}/detach`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${fixture.owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ...request, documentVersionVector: readRemoved }),
    },
  );
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({
    code: BLOB_MUTATION_ERROR_CODES.attachmentDocumentChanged,
  });
  expect(await activeBoundBlobIds(fixture.document.id)).toEqual([blobId]);
}, 20_000);
