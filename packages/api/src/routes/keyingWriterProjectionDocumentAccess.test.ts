import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { documentContentKeyEpochs } from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/test-utils";
import type { DocumentSyncRequest } from "@tearleads/validators/request";
import {
  isContainerMutationResponse,
  isDocumentSyncResponse,
  isDocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import { and, eq } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../test/helpers/authenticate";
import { createSignedDocumentSyncRequest } from "../../test/helpers/documentUpdateRequests";
import {
  accessManifestFromContainerResponse,
  bootstrapRoot,
  buildRootGrantRequest,
  createDocument,
  kekStateFromContainerResponse,
} from "../../test/helpers/keyingWriterProjectionKit";
import { buildRootRevokeRequest } from "../../test/helpers/keyingWriterProjectionRevoke";
import { registerUser } from "../../test/helpers/registerUser";
import { decodeServedDocumentProjection } from "../../test/helpers/servedWriterProjection";
import { withStoredContainerMutation } from "../../test/helpers/storedContainerMutation";
import { routeApp } from "../routeApp";

test("read-only document sync works for a user with read access to a linked container", async () => {
  const owner = createTestUser();
  const recipient = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  await registerUser(recipient);
  await authenticate(recipient);
  const root = await bootstrapRoot(owner);
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

  const grantRequest = await buildRootGrantRequest({
    accessLevel: "read",
    previous: root.bundle,
    previousKekState: root.kekState,
    recipient,
    signer: owner,
  });
  const shareResponse = await routeApp.request(
    `/containers/${root.kekState.containerId}/share`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(grantRequest),
    },
  );
  expect(shareResponse.status).toBe(200);

  const projectionResponse = await routeApp.request(
    `/documents/${created.id}/writer-projection`,
    {
      headers: {
        Authorization: `Bearer ${recipient.token}`,
      },
    },
  );
  expect(projectionResponse.status).toBe(200);
  const projection = decodeServedDocumentProjection(
    await projectionResponse.json(),
  );
  expect(isDocumentWriterProjectionResponse(projection)).toBe(true);

  const syncResponse = await routeApp.request(`/documents/${created.id}/sync`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${recipient.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contentKeyEpoch: projection.contentKeyBundle.contentKeyEpoch,
      expectedLinkSetManifestHash:
        projection.contentKeyBundle.linkSetManifestHash,
      expectedTargetHash: projection.contentKeyBundle.targetHash,
      localVersionVector: null,
      outgoingUpdates: [],
      supportsPullPagination: true,
    } satisfies DocumentSyncRequest),
  });

  expect(syncResponse.status).toBe(200);
  const synced = await syncResponse.json();
  expect(isDocumentSyncResponse(synced)).toBe(true);
  expect(synced.updates.map((update: { id: string }) => update.id)).toContain(
    updateId,
  );

  const stateChangingReadSyncResponse = await routeApp.request(
    `/documents/${created.id}/sync`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${recipient.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contentKeyBundle: projection.contentKeyBundle,
        contentKeyEpoch: projection.contentKeyBundle.contentKeyEpoch,
        expectedLinkSetManifestHash:
          projection.contentKeyBundle.linkSetManifestHash,
        expectedTargetHash: projection.contentKeyBundle.targetHash,
        localVersionVector: null,
        outgoingUpdates: [],
        supportsPullPagination: true,
      } satisfies DocumentSyncRequest),
    },
  );
  expect(stateChangingReadSyncResponse.status).toBe(400);
}, 10_000);

test("GET /documents/:documentId/writer-projection blocks revoked users after root KEK rotation", async () => {
  const owner = createTestUser();
  const recipient = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  await registerUser(recipient);
  await authenticate(recipient);
  const root = await bootstrapRoot(owner);
  const grantRequest = await buildRootGrantRequest({
    previous: root.bundle,
    previousKekState: root.kekState,
    recipient,
    signer: owner,
  });

  const shareResponse = await routeApp.request(
    `/containers/${root.kekState.containerId}/share`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(grantRequest),
    },
  );
  expect(shareResponse.status).toBe(200);
  const sharedBody = await shareResponse.json();
  expect(isContainerMutationResponse(sharedBody)).toBe(true);
  const shared = await withStoredContainerMutation(sharedBody);

  const recipientSharedProjectionResponse = await routeApp.request(
    `/containers/${root.kekState.containerId}/writer-projection`,
    {
      headers: {
        Authorization: `Bearer ${recipient.token}`,
      },
    },
  );
  expect(recipientSharedProjectionResponse.status).toBe(200);

  const revokeRequest = await buildRootRevokeRequest({
    previous: await accessManifestFromContainerResponse(shared),
    previousKekState: await kekStateFromContainerResponse(shared),
    revokedUser: recipient,
    signer: owner,
  });
  const revokeResponse = await routeApp.request(
    `/containers/${root.kekState.containerId}/revoke`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(revokeRequest),
    },
  );
  expect(revokeResponse.status).toBe(200);
  const revokedBody = await revokeResponse.json();
  expect(isContainerMutationResponse(revokedBody)).toBe(true);
  const revoked = await withStoredContainerMutation(revokedBody);
  expect(revoked.containerKek.containerKeyEpochId).not.toBe(
    shared.containerKek.containerKeyEpochId,
  );

  const created = await createDocument({
    owner,
    root: {
      bundle: await accessManifestFromContainerResponse(revoked),
      kekState: await kekStateFromContainerResponse(revoked),
      principalPolicies: root.principalPolicies,
    },
  });
  expect(created.documentKekTargets.linkedContainerKeyEpochIds).toEqual([
    revoked.containerKek.containerKeyEpochId,
  ]);
  expect(created.documentKekTargets.targets).toEqual([
    expect.objectContaining({
      containerId: root.kekState.containerId,
      containerKeyEpoch: revoked.containerKek.containerKeyEpoch,
      containerKeyEpochId: revoked.containerKek.containerKeyEpochId,
    }),
  ]);

  const ownerProjectionResponse = await routeApp.request(
    `/documents/${created.id}/writer-projection`,
    {
      headers: {
        Authorization: `Bearer ${owner.token}`,
      },
    },
  );
  expect(ownerProjectionResponse.status).toBe(200);
  const ownerProjection = decodeServedDocumentProjection(
    await ownerProjectionResponse.json(),
  );
  expect(isDocumentWriterProjectionResponse(ownerProjection)).toBe(true);
  expect(ownerProjection.contentKeyBundle.targets).toEqual([
    expect.objectContaining({
      containerId: root.kekState.containerId,
      containerKeyEpochId: revoked.containerKek.containerKeyEpochId,
    }),
  ]);

  const recipientProjectionResponse = await routeApp.request(
    `/documents/${created.id}/writer-projection`,
    {
      headers: {
        Authorization: `Bearer ${recipient.token}`,
      },
    },
  );
  expect(recipientProjectionResponse.status).toBe(403);
}, 10_000);

test("GET /documents/:documentId/writer-projection refreshes same-epoch root share targets", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const recipient = createTestUser();
  await registerUser(recipient);
  await authenticate(recipient);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });
  const shareRequest = await buildRootGrantRequest({
    previous: root.bundle,
    previousKekState: root.kekState,
    recipient,
    signer: owner,
  });
  const shareResponse = await routeApp.request(
    `/containers/${root.kekState.containerId}/share`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(shareRequest),
    },
  );

  expect(shareResponse.status).toBe(200);
  const sharedBody = await shareResponse.json();
  expect(isContainerMutationResponse(sharedBody)).toBe(true);
  const shared = await withStoredContainerMutation(sharedBody);
  const [storedBundleBeforeProjection] = await db
    .select({
      linkSetManifestHash: documentContentKeyEpochs.linkSetManifestHash,
      targetHash: documentContentKeyEpochs.targetHash,
    })
    .from(documentContentKeyEpochs)
    .where(
      and(
        eq(documentContentKeyEpochs.documentId, created.id),
        eq(documentContentKeyEpochs.contentKeyEpoch, created.contentKeyEpoch),
      ),
    )
    .limit(1);
  invariant(storedBundleBeforeProjection, "expected content-key bundle row");
  expect(storedBundleBeforeProjection.targetHash).toBe(created.targetHash);

  const projectionResponse = await routeApp.request(
    `/documents/${created.id}/writer-projection`,
    {
      headers: {
        Authorization: `Bearer ${recipient.token}`,
      },
    },
  );

  expect(projectionResponse.status).toBe(200);
  const projection = decodeServedDocumentProjection(
    await projectionResponse.json(),
  );
  expect(isDocumentWriterProjectionResponse(projection)).toBe(true);
  expect(projection.contentKeyBundle.contentKeyEpoch).toBe(
    created.contentKeyEpoch,
  );
  expect(projection.documentKekTargets.documentKeyTargetHash).toBe(
    projection.contentKeyBundle.targetHash,
  );
  expect(projection.contentKeyBundle.targetHash).not.toBe(
    storedBundleBeforeProjection.targetHash,
  );
  expect(projection.documentKekTargets.linkedContainerManifestHashes).toEqual([
    shared.manifestHead.manifestHash,
  ]);
  expect<unknown>(projection.contentKeyBundle.targets).toEqual([
    {
      ...created.contentKeyBundle.targets[0],
      containerManifestHash: shared.manifestHead.manifestHash,
    },
  ]);
  expect(projection.authorizingContainerPaths).toHaveLength(1);
  expect(
    projection.authorizingContainerPaths[0]?.containerKeks[0]?.containerManifestHistory?.map(
      (entry: { manifestHash: string }) => entry.manifestHash,
    ),
  ).toEqual([root.bundle.manifestHash]);

  const [storedBundleAfterProjection] = await db
    .select({
      linkSetManifestHash: documentContentKeyEpochs.linkSetManifestHash,
      targetHash: documentContentKeyEpochs.targetHash,
    })
    .from(documentContentKeyEpochs)
    .where(
      and(
        eq(documentContentKeyEpochs.documentId, created.id),
        eq(documentContentKeyEpochs.contentKeyEpoch, created.contentKeyEpoch),
      ),
    )
    .limit(1);
  expect(storedBundleAfterProjection).toEqual(storedBundleBeforeProjection);
}, 10_000);
