import { expect, test } from "bun:test";
import { createTestUser } from "@tearleads/bob-and-alice";
import { isContainerMutationResponse } from "@tearleads/validators/response";
import { authenticate } from "../../test/helpers/authenticate";
import {
  accessManifestFromContainerResponse,
  bootstrapRoot,
  buildRootGrantRequest,
  buildRootRevokeRequest,
  createDocument,
  kekStateFromContainerResponse,
} from "../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../test/helpers/registerUser";
import { routeApp } from "../routeApp";

// Reproduces the 409 seen when the Explorer sharing tab on a system folder
// (e.g. trash) shares-with-peer and/or revokes the share: the folder's metadata
// document already exists when the access change lands, so its stored
// content-key bundle still wraps to the pre-revoke container key epoch. A revoke
// rotates the container key epoch, and the read-only projection cannot re-wrap
// the content key to the new epoch (only a document sync carrying the plaintext
// content key can). Carry-forward is therefore refused and the read path returns
// 409. The single thing that makes this differ from the "blocks revoked users"
// test in keyingWriterProjection.test.ts is ordering: the document is created
// BEFORE the share/revoke, like a system folder's pre-existing metadata
// document.
test("GET /documents/:documentId/writer-projection is stale for a pre-existing document after a revoke rotates the container key epoch", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const recipient = createTestUser();
  await registerUser(recipient);
  await authenticate(recipient);
  const root = await bootstrapRoot(owner);

  // Document exists before any access change, like a system folder's metadata
  // document. Its content-key bundle is born wrapping to the current root epoch.
  const created = await createDocument({ owner, root });

  const ownerProjectionBeforeShare = await routeApp.request(
    `/documents/${created.id}/writer-projection`,
    {
      headers: {
        Authorization: `Bearer ${owner.token}`,
      },
    },
  );
  expect(ownerProjectionBeforeShare.status).toBe(200);

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
  const shared = await shareResponse.json();
  expect(isContainerMutationResponse(shared)).toBe(true);

  const revokeRequest = await buildRootRevokeRequest({
    previous: accessManifestFromContainerResponse(shared),
    previousKekState: kekStateFromContainerResponse(shared),
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
  const revoked = await revokeResponse.json();
  expect(isContainerMutationResponse(revoked)).toBe(true);
  // The revoke rotated the container key epoch; the document's stored bundle
  // still points at the pre-revoke epoch.
  expect(revoked.containerKek.containerKeyEpochId).not.toBe(
    root.kekState.containerKeyEpochId,
  );

  const projectionResponse = await routeApp.request(
    `/documents/${created.id}/writer-projection`,
    {
      headers: {
        Authorization: `Bearer ${owner.token}`,
      },
    },
  );

  // The read-only projection cannot carry the content key forward across the
  // key-epoch rotation, so it returns 409. The client clears this transient
  // state by re-syncing the metadata document (which re-wraps the content key
  // to the new epoch) — the read path is not expected to self-heal.
  expect(projectionResponse.status).toBe(409);
  expect(await projectionResponse.json()).toEqual({
    error: "Document content-key bundle is stale",
  });
}, 10_000);
