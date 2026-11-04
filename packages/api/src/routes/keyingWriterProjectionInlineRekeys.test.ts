import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { documentInlineRekeyCommits } from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/test-utils";
import {
  isContainerWriterProjectionResponse,
  isDocumentCreateResponse,
} from "@tearleads/validators/response";
import { authenticate } from "../../test/helpers/authenticate";
import {
  appendUnexpectedUserWrapToRekey,
  buildRootContainerRekeyMutation,
} from "../../test/helpers/containerRekey";
import { withDocumentMutationArtifacts } from "../../test/helpers/documentAcknowledgementFixture";
import { createSignedDocumentSyncRequest } from "../../test/helpers/documentUpdateRequests";
import {
  bootstrapRoot,
  createDocument,
  createDocumentRequest,
} from "../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../test/helpers/registerUser";
import { decodeServedContainerProjection } from "../../test/helpers/servedWriterProjection";
import { getCurrentContainerKeyEpoch } from "../access/read/containerKekStore";
import { routeApp } from "../routeApp";

test("POST /documents applies optional container rekeys before target validation", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const rootRekey = await buildRootContainerRekeyMutation({
    previous: root,
    signer: owner,
  });
  const request = await createDocumentRequest({
    owner,
    root: {
      bundle: rootRekey.bundle,
      kekState: rootRekey.kekState,
      principalPolicies: root.principalPolicies,
    },
  });
  request.containerRekeys = [rootRekey.request];

  const response = await routeApp.request("/documents", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${owner.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });

  expect(response.status).toBe(200);
  const createdBody = await response.json();
  expect(isDocumentCreateResponse(createdBody)).toBe(true);
  // The acknowledgement commits the target set the request wrapped to.
  expect(createdBody.targetHash).toBe(request.contentKeyBundle.targetHash);
  const created = withDocumentMutationArtifacts(request, createdBody);
  expect(created.documentKekTargets.linkedContainerKeyEpochIds).toEqual([
    rootRekey.kekState.containerKeyEpochId,
  ]);

  const currentRootEpoch = await getCurrentContainerKeyEpoch(
    root.kekState.containerId,
    db,
  );
  expect(currentRootEpoch?.id).toBe(rootRekey.kekState.containerKeyEpochId);

  const projectionResponse = await routeApp.request(
    `/containers/${root.kekState.containerId}/writer-projection`,
    {
      headers: {
        Authorization: `Bearer ${owner.token}`,
      },
    },
  );
  expect(projectionResponse.status).toBe(200);
  const projection = decodeServedContainerProjection(
    await projectionResponse.json(),
  );
  expect(isContainerWriterProjectionResponse(projection)).toBe(true);
  expect(
    projection.containerKeks[0]?.containerManifestHistory?.map(
      (entry: { manifestHash: string }) => entry.manifestHash,
    ),
  ).toEqual([root.bundle.manifestHash]);
});

test("POST /documents/:documentId/sync rolls back optional rekeys when write validation fails", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });
  const rekey = await buildRootContainerRekeyMutation({
    previous: root,
    signer: owner,
  });
  const { request } = await createSignedDocumentSyncRequest({
    created,
    owner,
    root,
  });
  request.containerRekeys = [rekey.request];
  request.inlineRekeyCommitId = "a".repeat(64);

  const syncResponse = await routeApp.request(`/documents/${created.id}/sync`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${owner.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });

  expect(syncResponse.status).toBe(409);
  const currentRootEpoch = await getCurrentContainerKeyEpoch(
    root.kekState.containerId,
    db,
  );
  expect(currentRootEpoch?.id).toBe(root.kekState.containerKeyEpochId);
});

test("POST /documents/:documentId/sync rejects invalid optional container rekeys", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });
  const rekey = await buildRootContainerRekeyMutation({
    previous: root,
    signer: owner,
  });
  appendUnexpectedUserWrapToRekey(rekey.request);
  const { request } = await createSignedDocumentSyncRequest({
    created,
    owner,
    root,
  });
  request.containerRekeys = [rekey.request];
  request.inlineRekeyCommitId = "b".repeat(64);

  const syncResponse = await routeApp.request(`/documents/${created.id}/sync`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${owner.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });

  expect(syncResponse.status).toBe(409);
  expect(await syncResponse.json()).toEqual({
    code: "document_sync_conflict",
    error: "container key wrap is not justified by its manifest",
  });
  const currentRootEpoch = await getCurrentContainerKeyEpoch(
    root.kekState.containerId,
    db,
  );
  expect(currentRootEpoch?.id).toBe(root.kekState.containerKeyEpochId);
});

test("POST /documents/:documentId/sync authorizes before probing an inline rekey commit", async () => {
  const owner = createTestUser();
  const outsider = createTestUser();
  await registerUser(owner);
  await registerUser(outsider);
  await authenticate(owner);
  await authenticate(outsider);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });
  const rekey = await buildRootContainerRekeyMutation({
    previous: root,
    signer: owner,
  });
  const { request } = await createSignedDocumentSyncRequest({
    created,
    owner,
    root,
  });
  const inlineRekeyCommitId = "c".repeat(64);
  request.containerRekeys = [rekey.request];
  request.inlineRekeyCommitId = inlineRekeyCommitId;
  await db.insert(documentInlineRekeyCommits).values({
    commitId: inlineRekeyCommitId,
    documentId: created.id,
  });

  const response = await routeApp.request(`/documents/${created.id}/sync`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${outsider.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });

  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: "Forbidden" });
});
