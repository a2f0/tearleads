import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  containerDocumentSyncTombstones,
  containers,
  documents,
  documentUpdates,
} from "@tearleads/api-shared/schema";
import type { DocumentAccessEventBody } from "@tearleads/crypto";
import { computeAccessEventHash } from "@tearleads/crypto";
import { emptyVersionVector } from "@tearleads/loro";
import { createTestUser } from "@tearleads/test-utils";
import type { DocumentLinkSetMutationRequest } from "@tearleads/validators/request";
import {
  DOCUMENT_MUTATION_ERROR_CODES,
  isDocumentLinkSetMutationResponse,
} from "@tearleads/validators/response";
import { and, eq, inArray } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../test/helpers/authenticate";
import { currentDocumentLinkRows } from "../../test/helpers/currentDocumentLinks";
import { withDocumentMutationArtifacts } from "../../test/helpers/documentAcknowledgementFixture";
import {
  buildDocumentLinkRequest,
  buildDocumentUnlinkRequest,
} from "../../test/helpers/documentLinkMutation";
import {
  createSignedDocumentSyncRequest,
  expectStaleAtomicUnlinkRollsBack,
} from "../../test/helpers/documentUpdateRequests";
import { createChildContainer } from "../../test/helpers/keyingWriterProjectionChild";
import {
  asVerifiedContainerManifest,
  bootstrapRoot,
  createDocument,
  createSignedAccessEvent,
} from "../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../test/helpers/registerUser";
import { postDocumentSync } from "../../test/helpers/staleBundleHealKit";
import { routeApp } from "../routeApp";

test("POST /documents/:documentId/link advances a signed link-set manifest", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const child = await createChildContainer({ parent: root, signer: owner });
  const createdDocument = await createDocument({ owner, root });
  const request = await buildDocumentLinkRequest({
    child,
    createdDocument,
    owner,
    root,
  });

  const response = await routeApp.request(
    `/documents/${createdDocument.id}/link`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    },
  );

  expect(response.status).toBe(200);
  const linked = await response.json();
  expect(isDocumentLinkSetMutationResponse(linked)).toBe(true);
  expect(linked.manifestHash).toBe(request.expectedManifestHash);
  expect(linked.eventHash).toBe(
    await computeAccessEventHash(
      request.event as unknown as Parameters<typeof computeAccessEventHash>[0],
    ),
  );
  expect(linked.targetHash).toBe(request.contentKeyBundle.targetHash);
  expect(request.contentKeyBundle.targets).toHaveLength(2);

  const rows = await currentDocumentLinkRows(createdDocument.id);
  expect(rows.map((row) => row.containerId).sort()).toEqual(
    [root.kekState.containerId, child.containerId].sort(),
  );
});

test("POST /documents/:documentId/link rejects stale previous manifests", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const child = await createChildContainer({ parent: root, signer: owner });
  const createdDocument = await createDocument({ owner, root });
  const staleRequest = await buildDocumentLinkRequest({
    child,
    createdDocument,
    owner,
    root,
  });
  const linkedResponse = await routeApp.request(
    `/documents/${createdDocument.id}/link`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(staleRequest),
    },
  );
  expect(linkedResponse.status).toBe(200);

  const nextChild = await createChildContainer({
    parent: root,
    signer: owner,
  });
  const staleSecondRequest = await buildDocumentLinkRequest({
    child: nextChild,
    createdDocument,
    owner,
    root,
  });
  const staleResponse = await routeApp.request(
    `/documents/${createdDocument.id}/link`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(staleSecondRequest),
    },
  );

  expect(staleResponse.status).toBe(409);
  // The server resolves the previous manifest from the current head, so a stale
  // link is rejected at the signed-event chain check (event.previousManifestHash
  // no longer matches the advanced head) rather than the downstream head pin.
  expect(await staleResponse.json()).toEqual({
    error:
      "document access event previous manifest does not match supplied previous manifest",
  });
});

/**
 * An owner's document with one committed update, linked to its root and to
 * one child container: an unlink must now rotate past that update.
 */
async function linkDocumentWithCommittedUpdate() {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const child = await createChildContainer({ parent: root, signer: owner });
  const createdDocument = await createDocument({ owner, root });
  const preRotationSync = await createSignedDocumentSyncRequest({
    created: createdDocument,
    owner,
    root,
  });
  expect(
    (await postDocumentSync(owner, createdDocument.id, preRotationSync.request))
      .status,
  ).toBe(200);
  const linkRequest = await buildDocumentLinkRequest({
    child,
    createdDocument,
    owner,
    root,
  });
  const linkResponse = await routeApp.request(
    `/documents/${createdDocument.id}/link`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(linkRequest),
    },
  );
  expect(linkResponse.status).toBe(200);
  const linkedDocument = withDocumentMutationArtifacts(
    linkRequest,
    await linkResponse.json(),
  );
  expect(isDocumentLinkSetMutationResponse(linkedDocument)).toBe(true);

  return { child, createdDocument, linkedDocument, owner, root };
}

test("POST /documents/:documentId/unlink requires a rotation baseline covering committed updates", async () => {
  const { child, createdDocument, linkedDocument, owner, root } =
    await linkDocumentWithCommittedUpdate();

  const missingBaselineRequest = await buildDocumentUnlinkRequest({
    child,
    linkedDocument,
    owner,
    root,
  });
  delete missingBaselineRequest.rotationBaseline;
  const missingBaselineResponse = await routeApp.request(
    `/documents/${createdDocument.id}/unlink`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(missingBaselineRequest),
    },
  );
  expect(missingBaselineResponse.status).toBe(409);
  expect(await missingBaselineResponse.json()).toEqual({
    code: DOCUMENT_MUTATION_ERROR_CODES.unlinkRotationBaselineStale,
    error:
      "Document unlink requires a rotation baseline covering committed updates",
  });
});

test("POST /documents/:documentId/unlink rolls back a stale atomic rotation baseline", async () => {
  const { child, createdDocument, linkedDocument, owner, root } =
    await linkDocumentWithCommittedUpdate();

  await expectStaleAtomicUnlinkRollsBack({
    buildRequest: () =>
      buildDocumentUnlinkRequest({
        child,
        linkedDocument,
        owner,
        root,
        rotationBaselineSourceVersionVector: emptyVersionVector(),
      }),
    documentId: createdDocument.id,
    token: owner.token,
  });
});

test("POST /documents/:documentId/unlink advances a signed link-set manifest", async () => {
  const { child, createdDocument, linkedDocument, owner, root } =
    await linkDocumentWithCommittedUpdate();

  const preUnlinkUpdatedAt = new Date("2026-05-05T00:00:00.000Z");
  await db
    .update(documents)
    .set({ updatedAt: preUnlinkUpdatedAt })
    .where(eq(documents.id, createdDocument.id));
  await db
    .update(containers)
    .set({ updatedAt: preUnlinkUpdatedAt })
    .where(
      inArray(containers.id, [root.kekState.containerId, child.containerId]),
    );

  const unlinkRequest = await buildDocumentUnlinkRequest({
    child,
    linkedDocument,
    owner,
    root,
  });
  const unlinkResponse = await routeApp.request(
    `/documents/${createdDocument.id}/unlink`,
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
  const unlinked = await unlinkResponse.json();
  expect(isDocumentLinkSetMutationResponse(unlinked)).toBe(true);
  expect(unlinked.manifestHash).toBe(unlinkRequest.expectedManifestHash);
  // The acknowledged target hash commits to the one remaining target.
  expect(unlinked.targetHash).toBe(unlinkRequest.contentKeyBundle.targetHash);
  expect(
    unlinkRequest.contentKeyBundle.targets.map((target) => target.containerId),
  ).toEqual([root.kekState.containerId]);
  expect(unlinked.contentKeyEpoch).toBe(linkedDocument.contentKeyEpoch + 1);

  const rows = await currentDocumentLinkRows(createdDocument.id);
  expect(rows.map((row) => row.containerId)).toEqual([
    root.kekState.containerId,
  ]);

  const [documentRow] = await db
    .select({ updatedAt: documents.updatedAt })
    .from(documents)
    .where(eq(documents.id, createdDocument.id))
    .limit(1);
  const touchedContainerRows = await db
    .select({
      id: containers.id,
      updatedAt: containers.updatedAt,
    })
    .from(containers)
    .where(
      inArray(containers.id, [root.kekState.containerId, child.containerId]),
    );
  const [tombstoneRow] = await db
    .select({
      containerId: containerDocumentSyncTombstones.containerId,
      documentId: containerDocumentSyncTombstones.documentId,
      updatedAt: containerDocumentSyncTombstones.updatedAt,
    })
    .from(containerDocumentSyncTombstones)
    .where(
      and(
        eq(containerDocumentSyncTombstones.containerId, child.containerId),
        eq(containerDocumentSyncTombstones.documentId, createdDocument.id),
      ),
    )
    .limit(1);
  invariant(documentRow, "expected touched document row");
  const unlinkUpdatedAt = documentRow.updatedAt.toISOString();
  expect(unlinkUpdatedAt).not.toBe(preUnlinkUpdatedAt.toISOString());
  expect(
    touchedContainerRows.map((row) => [row.id, row.updatedAt.toISOString()]),
  ).toEqual(
    expect.arrayContaining([
      [root.kekState.containerId, unlinkUpdatedAt],
      [child.containerId, unlinkUpdatedAt],
    ]),
  );
  expect(tombstoneRow).toEqual({
    containerId: child.containerId,
    documentId: createdDocument.id,
    updatedAt: documentRow.updatedAt,
  });
});

test("POST /documents/:documentId/unlink accepts a baseline-less unlink for an empty committed frontier", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const child = await createChildContainer({ parent: root, signer: owner });
  const createdDocument = await createDocument({ owner, root });
  const linkRequest = await buildDocumentLinkRequest({
    child,
    createdDocument,
    owner,
    root,
  });
  const linkResponse = await routeApp.request(
    `/documents/${createdDocument.id}/link`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(linkRequest),
    },
  );
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
  // A document with no committed updates has nothing for a rotation baseline
  // to cover, so the unlink may omit it entirely.
  delete unlinkRequest.rotationBaseline;
  const unlinkResponse = await routeApp.request(
    `/documents/${createdDocument.id}/unlink`,
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
  const unlinked = await unlinkResponse.json();
  expect(isDocumentLinkSetMutationResponse(unlinked)).toBe(true);
  expect(unlinked.manifestHash).toBe(unlinkRequest.expectedManifestHash);
  expect(unlinked.contentKeyEpoch).toBe(linkedDocument.contentKeyEpoch + 1);

  const rows = await currentDocumentLinkRows(createdDocument.id);
  expect(rows.map((row) => row.containerId)).toEqual([
    root.kekState.containerId,
  ]);

  const baselineRows = await db
    .select({ id: documentUpdates.id })
    .from(documentUpdates)
    .where(eq(documentUpdates.documentId, createdDocument.id));
  expect(baselineRows).toHaveLength(0);
});

test("POST /documents/:documentId/unlink rejects removing the final signed link", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const createdDocument = await createDocument({ owner, root });
  const body: DocumentAccessEventBody = {
    blobRewraps: [],
    eventType: "document.unlink",
    containerId: root.kekState.containerId,
    containerManifestHash: root.bundle.manifestHash,
  };
  const event = await createSignedAccessEvent({
    body,
    dependencyManifestHashes: [root.bundle.manifestHash],
    objectId: createdDocument.id,
    objectKind: "document",
    organizationId: asVerifiedContainerManifest(root.bundle).state
      .organizationId,
    previousManifestHash: createdDocument.manifestHash,
    signer: owner,
  });
  const request: DocumentLinkSetMutationRequest = {
    event: event.event as unknown as Record<string, unknown>,
    body: body as unknown as Record<string, unknown>,
    expectedManifestHash: createdDocument.manifestHash,
    manifest: createdDocument.accessManifest.manifest,
    targetContainerPathRefs: [
      {
        containerId: root.kekState.containerId,
        manifestHash: root.bundle.manifestHash,
      },
    ],
    authorizingContainerPathRefs: [
      [
        {
          containerId: root.kekState.containerId,
          manifestHash: root.bundle.manifestHash,
        },
      ],
    ],
    contentKeyBundle: {
      contentKeyEpoch: createdDocument.contentKeyEpoch,
      linkSetManifestHash: createdDocument.manifestHash,
      targetHash: createdDocument.targetHash,
      targets: createdDocument.contentKeyBundle.targets,
    },
  };

  const response = await routeApp.request(
    `/documents/${createdDocument.id}/unlink`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    },
  );

  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    error: "document.unlink must leave at least one linked container",
  });
});
