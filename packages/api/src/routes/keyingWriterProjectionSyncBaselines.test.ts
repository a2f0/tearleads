import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  containers,
  documentContentWriteHeaders,
  documents,
  documentUpdates,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/test-utils";
import type { DocumentSyncRequest } from "@tearleads/validators/request";
import {
  isDocumentLinkSetMutationResponse,
  isDocumentSyncResponse,
} from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../test/helpers/authenticate";
import { withDocumentMutationArtifacts } from "../../test/helpers/documentAcknowledgementFixture";
import {
  buildDocumentLinkRequest,
  buildDocumentUnlinkRequest,
} from "../../test/helpers/documentLinkMutation";
import { createSignedDocumentSyncRequest } from "../../test/helpers/documentUpdateRequests";
import { createChildContainer } from "../../test/helpers/keyingWriterProjectionChild";
import {
  bootstrapRoot,
  createDocument,
} from "../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../test/helpers/registerUser";
import { routeApp } from "../routeApp";

async function loadDocumentWriteRows(documentId: string) {
  const [rows, writeHeaders] = await Promise.all([
    db
      .select({
        id: documentUpdates.id,
        sourceVersionVector: documentUpdates.baselineSourceVersionVector,
      })
      .from(documentUpdates)
      .where(eq(documentUpdates.documentId, documentId)),
    db
      .select({ updateId: documentContentWriteHeaders.updateId })
      .from(documentContentWriteHeaders)
      .where(eq(documentContentWriteHeaders.documentId, documentId)),
  ]);
  const updates = rows.map(({ id }) => ({ id }));
  const baselines = rows.flatMap(({ id, sourceVersionVector }) =>
    sourceVersionVector === null
      ? []
      : [{ baselineUpdateId: id, sourceVersionVector }],
  );

  return { baselines, updates, writeHeaders };
}

test("POST /documents/:documentId/sync records a baseline once across a retried write", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });
  const { request, updateId } = await createSignedDocumentSyncRequest({
    checkpoint: true,
    created,
    owner,
    root,
  });
  const preSyncUpdatedAt = new Date("2026-05-05T00:00:00.000Z");
  await Promise.all([
    db
      .update(documents)
      .set({ updatedAt: preSyncUpdatedAt })
      .where(eq(documents.id, created.id)),
    db
      .update(containers)
      .set({ updatedAt: preSyncUpdatedAt })
      .where(eq(containers.id, root.kekState.containerId)),
  ]);

  const syncResponse = await routeApp.request(`/documents/${created.id}/sync`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${owner.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });
  expect(syncResponse.status).toBe(200);
  const synced = await syncResponse.json();
  expect(isDocumentSyncResponse(synced)).toBe(true);
  expect(synced.acceptedOutgoingUpdateIds).toEqual([updateId]);
  expect(synced.updates[0]?.authorizationTargets).toEqual(
    created.documentKekTargets.targets,
  );
  const [[syncedDocumentRow], [syncedContainerRow]] = await Promise.all([
    db
      .select({ updatedAt: documents.updatedAt })
      .from(documents)
      .where(eq(documents.id, created.id))
      .limit(1),
    db
      .select({ updatedAt: containers.updatedAt })
      .from(containers)
      .where(eq(containers.id, root.kekState.containerId))
      .limit(1),
  ]);
  invariant(syncedDocumentRow, "expected synced document row");
  invariant(syncedContainerRow, "expected synced container row");
  expect(syncedDocumentRow.updatedAt.toISOString()).not.toBe(
    preSyncUpdatedAt.toISOString(),
  );
  expect(syncedContainerRow.updatedAt.toISOString()).toBe(
    syncedDocumentRow.updatedAt.toISOString(),
  );

  const retryResponse = await routeApp.request(
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
  expect(retryResponse.status).toBe(200);
  const retried = await retryResponse.json();
  expect(isDocumentSyncResponse(retried)).toBe(true);
  expect(retried.acceptedOutgoingUpdateIds).toEqual([updateId]);

  const outgoing = request.outgoingUpdates[0];
  invariant(outgoing?.sourceVersionVector, "expected a baseline update");
  const { baselines, updates, writeHeaders } = await loadDocumentWriteRows(
    created.id,
  );
  expect(updates).toEqual([{ id: updateId }]);
  expect(writeHeaders).toEqual([{ updateId }]);
  expect(baselines).toEqual([
    {
      baselineUpdateId: updateId,
      sourceVersionVector: outgoing.sourceVersionVector,
    },
  ]);
});

test("POST /documents/:documentId/sync redirects historical updates to the atomic rotation baseline", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const child = await createChildContainer({ parent: root, signer: owner });
  const created = await createDocument({ owner, root });
  const { request, updateId } = await createSignedDocumentSyncRequest({
    created,
    owner,
    root,
  });

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
  expect(writeResponse.status).toBe(200);

  const linkRequest = await buildDocumentLinkRequest({
    child,
    createdDocument: created,
    owner,
    root,
  });
  const linkResponse = await routeApp.request(`/documents/${created.id}/link`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${owner.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(linkRequest),
  });
  expect(linkResponse.status).toBe(200);
  const linkedDocument = withDocumentMutationArtifacts(
    linkRequest,
    await linkResponse.json(),
  );
  expect(isDocumentLinkSetMutationResponse(linkedDocument)).toBe(true);

  const unlinkRequest = await buildDocumentUnlinkRequest({
    child,
    linkedDocument,
    owner,
    root,
  });
  const unlinkResponse = await routeApp.request(
    `/documents/${created.id}/unlink`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(unlinkRequest),
    },
  );
  expect(unlinkResponse.status).toBe(200);
  const unlinkedDocument = await unlinkResponse.json();
  expect(isDocumentLinkSetMutationResponse(unlinkedDocument)).toBe(true);

  const syncResponse = await routeApp.request(`/documents/${created.id}/sync`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${owner.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contentKeyEpoch: unlinkedDocument.contentKeyEpoch,
      expectedLinkSetManifestHash: unlinkedDocument.manifestHash,
      expectedTargetHash: unlinkedDocument.targetHash,
      localVersionVector: null,
      outgoingUpdates: [],
      supportsPullPagination: true,
    } satisfies DocumentSyncRequest),
  });

  expect(syncResponse.status).toBe(200);
  const synced = await syncResponse.json();
  expect(isDocumentSyncResponse(synced)).toBe(true);
  expect(synced.updates.map((update: { id: string }) => update.id)).toEqual([
    unlinkRequest.rotationBaseline?.id,
  ]);
  expect(
    synced.updates.map((update: { id: string }) => update.id),
  ).not.toContain(updateId);
  // The baseline is at the current epoch, whose bundle the response omits.
  expect(synced.contentKeyBundles).toEqual([]);
});
