import { expect, test } from "bun:test";
import { createTestUser } from "@tearleads/test-utils";
import type { ContainerManifestRef } from "@tearleads/validators/request";
import { authenticate } from "../../test/helpers/authenticate";
import { buildRootContainerRekeyMutation } from "../../test/helpers/containerRekey";
import { createSignedDocumentSyncRequest } from "../../test/helpers/documentUpdateRequests";
import {
  bootstrapRoot,
  createDocument,
  createDocumentRequest,
  type StoredRootFixture,
} from "../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../test/helpers/registerUser";
import { postDocumentSync } from "../../test/helpers/staleBundleHealKit";
import { routeApp } from "../routeApp";

test("POST /documents rejects malformed signed event records", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const request = await createDocumentRequest({ owner, root });

  request.event = {
    ...request.event,
    version: "2",
  };

  const response = await routeApp.request("/documents", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${owner.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error: "Document event.version is invalid",
  });
});

test("POST /documents/:documentId/sync rejects a write without authorization paths", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });
  const { request } = await createSignedDocumentSyncRequest({
    created,
    owner,
    root,
  });
  const { authorizingContainerPathRefs: _omitted, ...missingProofRequest } =
    request;

  const response = await routeApp.request(`/documents/${created.id}/sync`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${owner.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(missingProofRequest),
  });

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error: "Invalid request",
  });
});

function rootAuthorizingPathRef(root: StoredRootFixture): ContainerManifestRef {
  return {
    containerId: root.kekState.containerId,
    manifestHash: root.bundle.manifestHash,
  };
}

test("POST /documents/:documentId/sync emits the coded document_not_found 404 only for a positively-absent document", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });
  const { request } = await createSignedDocumentSyncRequest({
    created,
    owner,
    root,
  });

  const response = await postDocumentSync(owner, crypto.randomUUID(), request);

  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({
    code: "document_not_found",
    error: "Document not found",
  });
});

test("POST /documents/:documentId/sync rejects an unknown authorizing path ref with 409, never the wipe-signal 404", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });
  const { request } = await createSignedDocumentSyncRequest({
    created,
    owner,
    root,
  });

  const response = await postDocumentSync(owner, created.id, {
    ...request,
    authorizingContainerPathRefs: [
      [
        {
          containerId: root.kekState.containerId,
          manifestHash: "f".repeat(64),
        },
      ],
    ],
  });
  expect(response.status).toBe(409);
});

test("POST /documents/:documentId/sync rejects an authorizing path ref whose containerId does not match the resolved manifest with 400", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });
  const { request } = await createSignedDocumentSyncRequest({
    created,
    owner,
    root,
  });

  // A real, current manifestHash for the root, but a foreign containerId. The
  // server keys the head lookup off the resolved manifest's own containerId and
  // must reject the mismatch rather than authorize against the wrong container.
  const response = await postDocumentSync(owner, created.id, {
    ...request,
    authorizingContainerPathRefs: [
      [
        {
          containerId: crypto.randomUUID(),
          manifestHash: root.bundle.manifestHash,
        },
      ],
    ],
  });
  expect(response.status).toBe(400);
});

test("POST /documents/:documentId/sync rejects a stale authorizing path ref after the container head advances with 409", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });

  // Advance the root container's head past root.bundle.manifestHash. The old
  // manifest stays stored (resolvable by hash) but is no longer the head, so a
  // ref to it must be rejected as stale — without this pin a writer could replay
  // a manifest from an epoch where they held since-revoked access.
  const rootRekey = await buildRootContainerRekeyMutation({
    previous: root,
    signer: owner,
  });
  const rekeyDocument = await createDocumentRequest({
    owner,
    root: {
      bundle: rootRekey.bundle,
      kekState: rootRekey.kekState,
      principalPolicies: root.principalPolicies,
    },
  });
  rekeyDocument.containerRekeys = [rootRekey.request];
  const rekeyResponse = await routeApp.request("/documents", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${owner.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(rekeyDocument),
  });
  expect(rekeyResponse.status).toBe(200);

  const { request } = await createSignedDocumentSyncRequest({
    created,
    owner,
    root,
  });
  // The request's refs point at the now-stale pre-rekey root manifest hash.
  const response = await postDocumentSync(owner, created.id, {
    ...request,
    authorizingContainerPathRefs: [[rootAuthorizingPathRef(root)]],
  });
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({
    code: "document_sync_state_stale",
  });
});

test("POST /documents/:documentId/sync rejects a stale expectedLinkSetManifestHash with 409", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });
  const { request } = await createSignedDocumentSyncRequest({
    created,
    owner,
    root,
  });

  // The server resolves the document's link-set manifest from its own store and
  // pins it to the current head; a stale/forged expected hash (not the current
  // head) must be rejected rather than authorizing against a different link-set.
  const response = await postDocumentSync(owner, created.id, {
    ...request,
    expectedLinkSetManifestHash: "f".repeat(64),
  });
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({
    code: "document_sync_state_stale",
  });
});
