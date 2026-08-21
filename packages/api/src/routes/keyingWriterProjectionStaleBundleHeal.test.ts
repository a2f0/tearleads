import { expect, test } from "bun:test";
import { createTestUser } from "@symcrypt/bob-and-alice";
import {
  type DocumentWriterProjectionResponse,
  isDocumentSyncResponse,
  isDocumentWriterProjectionResponse,
} from "@symcrypt/validators/response";
import { authenticate } from "../../test/helpers/authenticate";
import {
  createSignedAtomicRotationBaseline,
  createSignedDocumentSyncRequest,
} from "../../test/helpers/documentUpdateRequests";
import {
  bootstrapRoot,
  createDocument,
} from "../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../test/helpers/registerUser";
import {
  buildHealedContentKeyBundle,
  getWriterProjection,
  postDocumentSync,
  shareAndRevokeRoot,
} from "../../test/helpers/staleBundleHealKit";

// The epoch-advance invariants of the stale-bundle heal: a sync that installs a
// current-epoch redirect must anchor it with a NEWLY WRITTEN rotation baseline
// that dominates the whole committed frontier. Current readers can still
// decrypt retained old epochs through predecessor KEKs, but an under-covering
// baseline must never become the redirect head. See
// keyingWriterProjectionStaleBundle.test.ts for projection and read tolerance.
test("a heal that advances the content-key epoch must carry a newly written baseline covering the committed frontier", async () => {
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

  // Also commit a covering baseline at the CURRENT epoch, to later prove an
  // epoch advance cannot ride on a replay of it.
  const organizationId = String(
    Reflect.get(created.accessManifest.state, "organizationId"),
  );
  const preRevokeBaseline = await createSignedAtomicRotationBaseline({
    accessManifestHash: created.contentKeyBundle.linkSetManifestHash,
    contentKeyEpoch: created.contentKeyBundle.contentKeyEpoch,
    documentId: created.id,
    organizationId,
    owner,
    targetHash: created.contentKeyBundle.targetHash,
  });
  const preRevokeBaselineResponse = await postDocumentSync(owner, created.id, {
    contentKeyEpoch: created.contentKeyBundle.contentKeyEpoch,
    expectedLinkSetManifestHash: created.contentKeyBundle.linkSetManifestHash,
    expectedTargetHash: created.contentKeyBundle.targetHash,
    authorizingContainerPathRefs: [
      [
        {
          containerId: root.kekState.containerId,
          manifestHash: root.bundle.manifestHash,
        },
      ],
    ],
    localVersionVector: null,
    outgoingUpdates: [preRevokeBaseline],
  });
  expect(preRevokeBaselineResponse.status).toBe(200);

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
  const revokedPathRefs = [
    [
      {
        containerId: revokedKek.containerId,
        manifestHash: revokedManifest.manifestHash,
      },
    ],
  ];
  const healedRequestEnvelope = {
    contentKeyEpoch: healedBundle.contentKeyEpoch,
    expectedLinkSetManifestHash: healedBundle.linkSetManifestHash,
    expectedTargetHash: healedBundle.targetHash,
    contentKeyBundle: {
      contentKeyEpoch: healedBundle.contentKeyEpoch,
      linkSetManifestHash: healedBundle.linkSetManifestHash,
      targetHash: healedBundle.targetHash,
      targets: healedBundle.targets,
    },
    authorizingContainerPathRefs: revokedPathRefs,
    localVersionVector: null,
  };

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

  // A baseline whose source vector does not decode is a client error, never
  // a 500 out of the vector decoder.
  const malformedVectorHeal = await createSignedDocumentSyncRequest({
    checkpoint: true,
    contentKeyBundle: healedBundle,
    created,
    includeContentKeyBundle: true,
    owner,
    root: revokedRoot,
  });
  const malformedVectorResponse = await postDocumentSync(owner, created.id, {
    ...malformedVectorHeal.request,
    outgoingUpdates: malformedVectorHeal.request.outgoingUpdates.map(
      (update) => ({ ...update, sourceVersionVector: "not-a-vector" }),
    ),
  });
  expect(malformedVectorResponse.status).toBe(400);
  expect((await malformedVectorResponse.json()).error).toBe(
    "Document content-key rotation baseline source vector is invalid",
  );

  // Replaying the already-committed pre-revoke baseline cannot anchor the
  // advance: the idempotent-retry path would keep its old-epoch write header,
  // so no baseline readable under the new key would exist.
  const replayedBaselineResponse = await postDocumentSync(owner, created.id, {
    ...healedRequestEnvelope,
    outgoingUpdates: [preRevokeBaseline],
  });
  expect(replayedBaselineResponse.status).toBe(409);
  expect((await replayedBaselineResponse.json()).error).toBe(
    "Document content-key rotation baseline must be newly written",
  );

  // The device holding the full history heals with a covering baseline.
  const coveringBaseline = await createSignedAtomicRotationBaseline({
    accessManifestHash: created.contentKeyBundle.linkSetManifestHash,
    contentKeyEpoch: healedBundle.contentKeyEpoch,
    documentId: created.id,
    organizationId,
    owner,
    targetHash: healedBundle.targetHash,
  });
  const coveringResponse = await postDocumentSync(owner, created.id, {
    ...healedRequestEnvelope,
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

  // An idempotent retry of the successful heal (lost ack) is accepted: its
  // already-committed baseline inserts nothing and cannot regress coverage.
  const retriedHealResponse = await postDocumentSync(owner, created.id, {
    ...healedRequestEnvelope,
    outgoingUpdates: [coveringBaseline],
  });
  expect(retriedHealResponse.status).toBe(200);

  // A NEW baseline at the (now current) healed epoch that does not cover the
  // committed frontier — e.g. a pre-heal checkpoint replayed with a fresh id
  // after a lost heal ack — must not shadow the covering baseline as the
  // newest one the redirect reads.
  const regressingCheckpoint = await createSignedDocumentSyncRequest({
    checkpoint: true,
    contentKeyBundle: healedBundle,
    created,
    owner,
    root: revokedRoot,
  });
  const regressingResponse = await postDocumentSync(
    owner,
    created.id,
    regressingCheckpoint.request,
  );
  expect(regressingResponse.status).toBe(409);
  expect((await regressingResponse.json()).error).toBe(
    "Document content-key rotation baseline does not cover the committed frontier",
  );

  // A concurrent healer that lost the race submits its OWN fresh key at the
  // now-occupied epoch. That conflict must be coded stale — the client's
  // retry path refetches the healed projection and resubmits against it —
  // never an uncoded terminal 409 that strands the loser's queued writes.
  const losingBaseline = await createSignedAtomicRotationBaseline({
    accessManifestHash: created.contentKeyBundle.linkSetManifestHash,
    contentKeyEpoch: healedBundle.contentKeyEpoch,
    documentId: created.id,
    organizationId,
    owner,
    targetHash: healedBundle.targetHash,
  });
  const losingHealResponse = await postDocumentSync(owner, created.id, {
    ...healedRequestEnvelope,
    contentKeyBundle: {
      ...healedRequestEnvelope.contentKeyBundle,
      targets: healedBundle.targets.map((target) => ({
        ...target,
        wrappedKey: `document-key:${created.id}:losing-healer`,
      })),
    },
    outgoingUpdates: [losingBaseline],
  });
  expect(losingHealResponse.status).toBe(409);
  expect(await losingHealResponse.json()).toEqual({
    code: "document_sync_state_stale",
    error: "Document content-key bundle conflict",
  });
}, 20_000);
