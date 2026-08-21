import { expect, test } from "bun:test";
import { createTestUser } from "@symcrypt/bob-and-alice";
import {
  type DocumentWriterProjectionResponse,
  isDocumentSyncResponse,
  isDocumentWriterProjectionResponse,
} from "@symcrypt/validators/response";
import { authenticate } from "../../test/helpers/authenticate";
import { createSignedDocumentSyncRequest } from "../../test/helpers/documentUpdateRequests";
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
// content-key epoch (see keyingWriterProjectionStaleBundleHeal.test.ts for
// the epoch-advance invariants).

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
  // stale bundle AND the current targets in one self-consistent response to
  // heal the document.
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
  const preRevokeResponse = await postDocumentSync(
    owner,
    created.id,
    preRevokeSync.request,
  );
  expect(preRevokeResponse.status).toBe(200);

  await shareAndRevokeRoot({ owner, root });

  // A reader synced to the stale state pulls with the stale expectations; the
  // response echoes the bundle-derived targets so the stale pair stays
  // self-consistent instead of mixing in the current (unhealed) targets.
  const readOnlyResponse = await postDocumentSync(owner, created.id, {
    contentKeyEpoch: created.contentKeyBundle.contentKeyEpoch,
    expectedLinkSetManifestHash: created.contentKeyBundle.linkSetManifestHash,
    expectedTargetHash: created.contentKeyBundle.targetHash,
    localVersionVector: null,
    outgoingUpdates: [],
  });
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
  // the client sync workflow submits after seeing contentKeyBundleStale. With
  // no committed updates there is nothing a rotation baseline must dominate,
  // so a plain update may anchor the advance.
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
  const healingResponse = await postDocumentSync(
    owner,
    created.id,
    healingSync.request,
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
