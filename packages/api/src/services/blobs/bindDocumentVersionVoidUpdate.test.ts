import { expect, test } from "bun:test";
import type { VerifiedAttachmentBinding } from "@tearleads/crypto";
import {
  emptyVersionVector,
  encodeVersionVectorCounters,
  mergeVersionVectors,
} from "@tearleads/loro";
import { BLOB_MUTATION_ERROR_CODES } from "@tearleads/validators/response";
import {
  activeBoundBlobIds,
  type DocumentVersionFixture,
  documentWithRoot,
  stagedBind,
} from "../../../test/helpers/attachmentDocumentVersionKit";
import {
  bindForTest,
  buildDetach,
  detachForTest,
} from "../../../test/helpers/blobAttachmentKit";
import {
  createSignedDocumentSyncRequest,
  type DeclaredSpan,
} from "../../../test/helpers/documentUpdateRequests";
import { postDocumentSync } from "../../../test/helpers/staleBundleHealKit";

/** A span no reader's version will ever cover: its ops do not exist. */
const OVERCLAIM: DeclaredSpan = {
  partialStartVersionVector: emptyVersionVector(),
  partialEndVersionVector: encodeVersionVectorCounters({ "4242": 1_000_000 }),
};

const documentChanged = {
  code: BLOB_MUTATION_ERROR_CODES.attachmentDocumentChanged,
  status: 409,
};

/** Commits one update; returns its id and the version end it declares. */
async function commit(
  fixture: DocumentVersionFixture,
  declaredSpan?: DeclaredSpan,
): Promise<{ readonly end: string; readonly id: string }> {
  const { request, updateId } = await createSignedDocumentSyncRequest({
    created: fixture.document,
    declaredSpan,
    owner: fixture.owner,
    root: fixture.root,
  });
  const response = await postDocumentSync(
    fixture.owner,
    fixture.document.id,
    request,
  );
  expect(response.status, await response.clone().text()).toBe(200);
  const [update] = request.outgoingUpdates;
  if (!update) throw new Error("Expected one update");
  return { end: update.partialEndVersionVector, id: updateId };
}

/**
 * A document with one honest update, then an overclaimed one that every
 * reader voids. `honest` is the version a reader holds after judging both.
 */
async function documentWithVoidUpdate() {
  const fixture = await documentWithRoot();
  const honest = await commit(fixture);
  const liar = await commit(fixture, OVERCLAIM);
  return { fixture, honest: honest.end, liarId: liar.id };
}

test("a bind past an update every reader voids needs the cursor that judged it", async () => {
  const { fixture, honest, liarId } = await documentWithVoidUpdate();
  const { blobId, request } = await stagedBind(fixture);
  const atHonest = { ...request, documentVersionVector: honest };
  const bind = (cursor: string | undefined) =>
    bindForTest({
      blobId,
      owner: fixture.owner,
      request:
        cursor === undefined
          ? atHonest
          : { ...atHonest, processedThroughUpdateId: cursor },
    });

  // No version can hold the overclaim, so without a cursor every bind is
  // refused; a cursor this document does not hold counts as none.
  await expect(bind(undefined)).rejects.toMatchObject(documentChanged);
  await expect(bind(crypto.randomUUID())).rejects.toMatchObject(
    documentChanged,
  );
  expect(await activeBoundBlobIds(fixture.document.id)).toEqual([]);

  // An honest edit after the cursor still refuses a version that lacks it.
  const later = await commit(fixture);
  await expect(bind(liarId)).rejects.toMatchObject(documentChanged);
  expect(await activeBoundBlobIds(fixture.document.id)).toEqual([]);

  // Past the judged overclaim, the version holding every honest op binds.
  await bindForTest({
    blobId,
    owner: fixture.owner,
    request: {
      ...atHonest,
      documentVersionVector: mergeVersionVectors([honest, later.end]),
      processedThroughUpdateId: liarId,
    },
  });
  expect(await activeBoundBlobIds(fixture.document.id)).toEqual([blobId]);
}, 30_000);

async function detach(
  fixture: DocumentVersionFixture,
  binding: VerifiedAttachmentBinding,
  version: { readonly cursor?: string; readonly vector: string },
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
      documentVersionVector: version.vector,
      ...(version.cursor === undefined
        ? {}
        : { processedThroughUpdateId: version.cursor }),
    },
  });
}

test("a detach past an update every reader voids needs the cursor that judged it", async () => {
  const { fixture, honest, liarId } = await documentWithVoidUpdate();
  const { binding, blobId, request } = await stagedBind(fixture);
  await bindForTest({
    blobId,
    owner: fixture.owner,
    request: {
      ...request,
      documentVersionVector: honest,
      processedThroughUpdateId: liarId,
    },
  });

  await expect(
    detach(fixture, binding, { vector: honest }),
  ).rejects.toMatchObject(documentChanged);
  expect(await activeBoundBlobIds(fixture.document.id)).toEqual([blobId]);

  await detach(fixture, binding, { cursor: liarId, vector: honest });
  expect(await activeBoundBlobIds(fixture.document.id)).toEqual([]);
}, 30_000);
