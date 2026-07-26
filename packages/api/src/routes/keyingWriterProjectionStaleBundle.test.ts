import { expect, test } from "bun:test";
import { createTestUser, type TestUser } from "@tearleads/bob-and-alice";
import { computeDocumentContentKeyTargetHash } from "@tearleads/crypto";
import {
  type DocumentCreateResponse,
  type DocumentWriterProjectionResponse,
  isContainerMutationResponse,
  isDocumentSyncResponse,
  isDocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import { authenticate } from "../../test/helpers/authenticate";
import {
  createSignedAtomicRotationBaseline,
  createSignedDocumentSyncRequest,
} from "../../test/helpers/documentUpdateRequests";
import {
  accessManifestFromContainerResponse,
  bootstrapRoot,
  buildRootGrantRequest,
  buildRootRevokeRequest,
  createDocument,
  kekStateFromContainerResponse,
  type StoredRootFixture,
} from "../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../test/helpers/registerUser";
import { routeApp } from "../routeApp";

// Reproduces the sync deadlock seen when a share/revoke on a container (e.g.
// the Explorer sharing tab on root) rotates the container key epoch while a
// pre-existing document's stored content-key bundle still wraps to the
// pre-revoke epoch. The server cannot re-wrap the content key (only a client
// holding the plaintext key can), so it must NOT answer with a blanket 409:
// that would also withhold the current KEK targets the healing client needs,
// leaving queued writes permanently stuck. Instead the projection serves the
// stale bundle marked contentKeyBundleStale alongside the CURRENT targets,
// read-only pulls stay served against the stored bundle, and a write-bearing
// sync heals the document by carrying a re-wrapped bundle at the next
// content-key epoch.

async function shareAndRevokeRoot(input: {
  readonly owner: TestUser;
  readonly root: StoredRootFixture;
}) {
  const recipient = createTestUser();
  await registerUser(recipient);
  await authenticate(recipient);

  const shareRequest = await buildRootGrantRequest({
    previous: input.root.bundle,
    previousKekState: input.root.kekState,
    recipient,
    signer: input.owner,
  });
  const shareResponse = await routeApp.request(
    `/containers/${input.root.kekState.containerId}/share`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(shareRequest),
    },
  );
  expect(shareResponse.status).toBe(200);
  const shared = await shareResponse.json();
  expect(isContainerMutationResponse(shared)).toBe(true);

  const revokeRequest = await buildRootRevokeRequest({
    previous: accessManifestFromContainerResponse(shared),
    previousKekState: kekStateFromContainerResponse(shared),
    revokedUser: recipient,
    signer: input.owner,
  });
  const revokeResponse = await routeApp.request(
    `/containers/${input.root.kekState.containerId}/revoke`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(revokeRequest),
    },
  );
  expect(revokeResponse.status).toBe(200);
  const revoked = await revokeResponse.json();
  expect(isContainerMutationResponse(revoked)).toBe(true);
  // The revoke rotated the container key epoch; the document's stored bundle
  // still points at the pre-revoke epoch.
  expect(revoked.containerKek.containerKeyEpochId).not.toBe(
    input.root.kekState.containerKeyEpochId,
  );

  return {
    revokedKek: kekStateFromContainerResponse(revoked),
    revokedManifest: accessManifestFromContainerResponse(revoked),
  };
}

async function getWriterProjection(
  owner: TestUser,
  documentId: string,
): Promise<{ response: Response; projection: unknown }> {
  const response = await routeApp.request(
    `/documents/${documentId}/writer-projection`,
    {
      headers: {
        Authorization: `Bearer ${owner.token}`,
      },
    },
  );
  return { response, projection: await response.json() };
}

async function buildHealedContentKeyBundle(input: {
  readonly created: DocumentCreateResponse;
  readonly revokedKek: ReturnType<typeof kekStateFromContainerResponse>;
  readonly revokedManifestHash: string;
}): Promise<DocumentCreateResponse["contentKeyBundle"]> {
  const targets = [
    {
      containerId: input.revokedKek.containerId,
      containerManifestHash: input.revokedManifestHash,
      containerKeyEpochId: input.revokedKek.containerKeyEpochId,
      containerKeyEpoch: input.revokedKek.containerKeyEpoch,
    },
  ];

  return {
    contentKeyEpoch: input.created.contentKeyBundle.contentKeyEpoch + 1,
    documentId: input.created.id,
    linkSetManifestHash: input.created.contentKeyBundle.linkSetManifestHash,
    targetHash: await computeDocumentContentKeyTargetHash(targets),
    targets: targets.map((target) => ({
      ...target,
      wrappedKey: `document-key:${input.created.id}:rewrapped`,
      wrappingMetadata: { alg: "test-wrap" },
    })),
  };
}

test("GET /documents/:documentId/writer-projection serves the stale bundle with current targets after a revoke rotates the container key epoch", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);

  // Document exists before any access change, like a system folder's metadata
  // document. Its content-key bundle is born wrapping to the current root epoch.
  const created = await createDocument({ owner, root });

  const beforeShare = await getWriterProjection(owner, created.id);
  expect(beforeShare.response.status).toBe(200);

  const { revokedKek } = await shareAndRevokeRoot({ owner, root });

  // The projection cannot carry the content key forward across the key-epoch
  // rotation, but it must not 409: a writer that spans the rotation needs the
  // stale bundle (to unwrap the content key via KEK history) AND the current
  // targets (to re-wrap it) in one self-consistent response.
  const { response, projection } = await getWriterProjection(owner, created.id);
  expect(response.status).toBe(200);
  expect(isDocumentWriterProjectionResponse(projection)).toBe(true);
  const staleProjection = projection as DocumentWriterProjectionResponse;
  expect(staleProjection.contentKeyBundleStale).toBe(true);
  expect(staleProjection.contentKeyBundle.contentKeyEpoch).toBe(
    created.contentKeyBundle.contentKeyEpoch,
  );
  expect(staleProjection.contentKeyBundle.targetHash).toBe(
    created.contentKeyBundle.targetHash,
  );
  expect(staleProjection.documentKekTargets.documentKeyTargetHash).not.toBe(
    created.contentKeyBundle.targetHash,
  );
  expect(staleProjection.documentKekTargets.linkedContainerKeyEpochIds).toEqual(
    [revokedKek.containerKeyEpochId],
  );
}, 10_000);

test("read-only document sync pulls stay served against the stored bundle while it is stale", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });

  // Commit one update before the rotation so the stale-state pull has
  // something to serve.
  const preRevokeSync = await createSignedDocumentSyncRequest({
    created,
    owner,
    root,
  });
  const preRevokeResponse = await routeApp.request(
    `/documents/${created.id}/sync`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(preRevokeSync.request),
    },
  );
  expect(preRevokeResponse.status).toBe(200);

  await shareAndRevokeRoot({ owner, root });

  // A reader synced to the stale state pulls with the stale expectations; the
  // response echoes the bundle-derived targets so the stale pair stays
  // self-consistent instead of mixing in the current (unhealed) targets.
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
      }),
    },
  );
  expect(readOnlyResponse.status).toBe(200);
  const readOnly = await readOnlyResponse.json();
  expect(isDocumentSyncResponse(readOnly)).toBe(true);
  expect(readOnly.updates.map((update: { id: string }) => update.id)).toContain(
    preRevokeSync.updateId,
  );
  expect(readOnly.contentKeyBundle.contentKeyEpoch).toBe(
    created.contentKeyBundle.contentKeyEpoch,
  );
  expect(readOnly.documentKekTargets.documentKeyTargetHash).toBe(
    created.contentKeyBundle.targetHash,
  );
}, 10_000);

test("a write-bearing sync heals the stale bundle at the next content-key epoch", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });

  const { revokedKek, revokedManifest } = await shareAndRevokeRoot({
    owner,
    root,
  });

  // The healing writer re-wraps the content key to the current targets at the
  // next epoch and carries the bundle with its queued update — exactly what
  // the client sync workflow submits after seeing contentKeyBundleStale.
  const healedBundle = await buildHealedContentKeyBundle({
    created,
    revokedKek,
    revokedManifestHash: revokedManifest.manifestHash,
  });
  const healingSync = await createSignedDocumentSyncRequest({
    contentKeyBundle: healedBundle,
    created,
    includeContentKeyBundle: true,
    owner,
    root: { bundle: revokedManifest, kekState: revokedKek },
  });
  const healingResponse = await routeApp.request(
    `/documents/${created.id}/sync`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(healingSync.request),
    },
  );
  expect(healingResponse.status).toBe(200);
  const healed = await healingResponse.json();
  expect(isDocumentSyncResponse(healed)).toBe(true);
  expect(healed.acceptedOutgoingUpdateIds).toContain(healingSync.updateId);
  expect(healed.contentKeyBundle.contentKeyEpoch).toBe(
    healedBundle.contentKeyEpoch,
  );

  // The document is healed for everyone: the projection is current again and
  // no longer flags the bundle.
  const { response, projection } = await getWriterProjection(owner, created.id);
  expect(response.status).toBe(200);
  expect(isDocumentWriterProjectionResponse(projection)).toBe(true);
  const healedProjection = projection as DocumentWriterProjectionResponse;
  expect(healedProjection.contentKeyBundleStale).toBeUndefined();
  expect(healedProjection.contentKeyBundle.contentKeyEpoch).toBe(
    healedBundle.contentKeyEpoch,
  );
  expect(healedProjection.contentKeyBundle.targetHash).toBe(
    healedBundle.targetHash,
  );
  expect(healedProjection.documentKekTargets.documentKeyTargetHash).toBe(
    healedBundle.targetHash,
  );
}, 15_000);

async function postDocumentSync(
  owner: TestUser,
  documentId: string,
  request: unknown,
): Promise<Response> {
  return routeApp.request(`/documents/${documentId}/sync`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${owner.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });
}

test("a heal that advances the content-key epoch must carry a baseline covering the committed frontier", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });

  // Commit one pre-rotation update so the committed frontier is non-empty.
  const preRevokeSync = await createSignedDocumentSyncRequest({
    created,
    owner,
    root,
  });
  const preRevokeResponse = await postDocumentSync(
    owner,
    created.id,
    preRevokeSync.request,
  );
  expect(preRevokeResponse.status).toBe(200);

  const { revokedKek, revokedManifest } = await shareAndRevokeRoot({
    owner,
    root,
  });
  const healedBundle = await buildHealedContentKeyBundle({
    created,
    revokedKek,
    revokedManifestHash: revokedManifest.manifestHash,
  });
  const revokedRoot = { bundle: revokedManifest, kekState: revokedKek };

  // An epoch advance with no baseline would orphan the committed pre-rotation
  // update for every reader; the server refuses it.
  const baselinelessHeal = await createSignedDocumentSyncRequest({
    contentKeyBundle: healedBundle,
    created,
    includeContentKeyBundle: true,
    owner,
    root: revokedRoot,
  });
  const baselinelessResponse = await postDocumentSync(
    owner,
    created.id,
    baselinelessHeal.request,
  );
  expect(baselinelessResponse.status).toBe(409);
  expect((await baselinelessResponse.json()).error).toBe(
    "Document content-key rotation requires a rotation baseline covering committed updates",
  );

  // A baseline built by a device that never saw the committed update does not
  // dominate the frontier; the server refuses that too.
  const underCoveringHeal = await createSignedDocumentSyncRequest({
    checkpoint: true,
    contentKeyBundle: healedBundle,
    created,
    includeContentKeyBundle: true,
    owner,
    root: revokedRoot,
  });
  const underCoveringResponse = await postDocumentSync(
    owner,
    created.id,
    underCoveringHeal.request,
  );
  expect(underCoveringResponse.status).toBe(409);
  expect((await underCoveringResponse.json()).error).toBe(
    "Document content-key rotation baseline does not cover the committed frontier",
  );

  // The device holding the full history heals with a covering baseline.
  const coveringBaseline = await createSignedAtomicRotationBaseline({
    accessManifestHash: created.contentKeyBundle.linkSetManifestHash,
    contentKeyEpoch: healedBundle.contentKeyEpoch,
    documentId: created.id,
    organizationId: String(
      Reflect.get(created.accessManifest.state, "organizationId"),
    ),
    owner,
    targetHash: healedBundle.targetHash,
  });
  const coveringResponse = await postDocumentSync(owner, created.id, {
    contentKeyEpoch: healedBundle.contentKeyEpoch,
    expectedLinkSetManifestHash: healedBundle.linkSetManifestHash,
    expectedTargetHash: healedBundle.targetHash,
    contentKeyBundle: {
      contentKeyEpoch: healedBundle.contentKeyEpoch,
      linkSetManifestHash: healedBundle.linkSetManifestHash,
      targetHash: healedBundle.targetHash,
      targets: healedBundle.targets,
    },
    authorizingContainerPathRefs: [
      [
        {
          containerId: revokedKek.containerId,
          manifestHash: revokedManifest.manifestHash,
        },
      ],
    ],
    localVersionVector: null,
    outgoingUpdates: [coveringBaseline],
  });
  expect(coveringResponse.status).toBe(200);
  const healed = await coveringResponse.json();
  expect(isDocumentSyncResponse(healed)).toBe(true);
  expect(healed.acceptedOutgoingUpdateIds).toContain(coveringBaseline.id);

  const { response, projection } = await getWriterProjection(owner, created.id);
  expect(response.status).toBe(200);
  expect(isDocumentWriterProjectionResponse(projection)).toBe(true);
  const healedProjection = projection as DocumentWriterProjectionResponse;
  expect(healedProjection.contentKeyBundleStale).toBeUndefined();
  expect(healedProjection.contentKeyBundle.contentKeyEpoch).toBe(
    healedBundle.contentKeyEpoch,
  );

  // Once healed, the stale read tolerance must not pin pre-heal readers to
  // the superseded bundle: they get the coded stale 409, which routes them to
  // the healed projection.
  const supersededReadOnlyResponse = await postDocumentSync(owner, created.id, {
    contentKeyEpoch: created.contentKeyBundle.contentKeyEpoch,
    expectedLinkSetManifestHash: created.contentKeyBundle.linkSetManifestHash,
    expectedTargetHash: created.contentKeyBundle.targetHash,
    localVersionVector: null,
    outgoingUpdates: [],
  });
  expect(supersededReadOnlyResponse.status).toBe(409);
  expect((await supersededReadOnlyResponse.json()).code).toBe(
    "document_sync_state_stale",
  );
}, 15_000);
