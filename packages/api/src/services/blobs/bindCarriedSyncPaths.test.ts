import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  attachmentBindings,
  documentUpdates,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/test-utils";
import { isDocumentSyncResponse } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import { authenticate } from "../../../test/helpers/authenticate";
import {
  blobAttachmentTestRuntime,
  buildBind,
  stageBlob,
} from "../../../test/helpers/blobAttachmentKit";
import { createFirstUpdateSyncRequest } from "../../../test/helpers/documentUpdateRequests";
import { createChildContainer } from "../../../test/helpers/keyingWriterProjectionChild";
import {
  asVerifiedContainerManifest,
  bootstrapRoot,
  createDocument,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";
import { BlobMutationError, bindBlobAttachment } from "./blobMutations";

/**
 * The statuses on which the SDK's carrying bind binds again without its
 * document sync and leaves the queued row to sync alone
 * (`bindRefusedCarriedSync` in the client SDK's blob upload workflow).
 */
const CLIENT_FALLBACK_STATUSES = [400, 403, 404, 409];

async function storedState(documentId: string) {
  const [bindings, updates] = await Promise.all([
    db
      .select({ blobId: attachmentBindings.blobId })
      .from(attachmentBindings)
      .where(eq(attachmentBindings.documentId, documentId)),
    db
      .select({ id: documentUpdates.id })
      .from(documentUpdates)
      .where(eq(documentUpdates.documentId, documentId)),
  ]);
  return {
    bindingBlobIds: bindings.map((row) => row.blobId),
    updateIds: updates.map((row) => row.id),
  };
}

/**
 * A document linked to its root, a sibling container under the same root,
 * and a staged bind whose own authorizing path is the root alone.
 */
async function bindOutsideAncestorFixture() {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const document = await createDocument({ owner, root });
  const sibling = asVerifiedContainerManifest(
    (await createChildContainer({ parent: root, signer: owner }))
      .accessManifest,
  );
  const blobId = crypto.randomUUID();
  const { request } = await buildBind({
    blobId,
    document,
    owner,
    root,
    stagedBlob: await stageBlob(owner, blobId),
  });
  return {
    blobId,
    document,
    owner,
    request,
    root,
    rootRef: {
      containerId: root.kekState.containerId,
      manifestHash: root.bundle.manifestHash,
    },
    siblingRef: {
      containerId: sibling.state.containerId,
      manifestHash: sibling.manifestHash,
    },
  };
}

function bind(
  fixture: Awaited<ReturnType<typeof bindOutsideAncestorFixture>>,
  request: Parameters<typeof bindBlobAttachment>[1]["request"],
) {
  return bindBlobAttachment(blobAttachmentTestRuntime, {
    blobId: fixture.blobId,
    fingerprint: fixture.owner.fingerprint,
    request,
    sessionId: "bind-carried-sync-paths-test",
    userId: fixture.owner.userId,
  });
}

// A valid authorizing path ends at a linked container, so every ancestor it
// names is already in the bind's lock plan through the linked heads' ancestor
// closure. The only carried path that names a head outside the bind's own
// path therefore cites a container the document is not linked under. The bind
// locks it ahead of the blob rows (so `requireHeldHeads` admits the carried
// write), the carried sync's own verification refuses it, and the whole bind
// rolls back with a status the client answers with a plain bind.
test("a carried sync citing a container outside the bind's path refuses cleanly and its row still commits alone", async () => {
  const fixture = await bindOutsideAncestorFixture();
  const carried = await createFirstUpdateSyncRequest({
    authorizingContainerPathRefs: [
      [fixture.rootRef],
      [fixture.rootRef, fixture.siblingRef],
    ],
    document: fixture.document,
    owner: fixture.owner,
    root: fixture.root,
  });

  const failure = await bind(fixture, {
    ...fixture.request,
    documentSync: carried.request,
  }).catch((error: unknown) => error);

  expect(failure).toBeInstanceOf(BlobMutationError);
  // The carried write reached its own verification: every head it names was
  // held, so the bind's lock plan covered the extra container.
  expect(failure).toMatchObject({
    message: "write header authorizing path is outside the signed target scope",
    status: 400,
  });
  expect(CLIENT_FALLBACK_STATUSES).toContain(
    (failure as BlobMutationError).status,
  );
  expect(await storedState(fixture.document.id)).toEqual({
    bindingBlobIds: [],
    updateIds: [],
  });

  // The client's fallback: the same bind without the carried sync...
  const plain = await bind(fixture, fixture.request);
  expect(plain.documentSync).toBeUndefined();

  // ...then the still-queued row syncs on its own under its original id,
  // re-signed against the paths a plain sync cites.
  const alone = await createFirstUpdateSyncRequest({
    document: fixture.document,
    owner: fixture.owner,
    root: fixture.root,
    updateId: carried.id,
  });
  const response = await routeApp.request(
    `/documents/${fixture.document.id}/sync`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${fixture.owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(alone.request),
    },
  );
  expect(response.status).toBe(200);
  const synced: unknown = await response.json();
  expect(isDocumentSyncResponse(synced)).toBe(true);
  expect(synced).toMatchObject({ acceptedOutgoingUpdateIds: [carried.id] });
  expect(await storedState(fixture.document.id)).toEqual({
    bindingBlobIds: [fixture.blobId],
    updateIds: [carried.id],
  });
}, 30_000);
