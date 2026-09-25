import { expect, test } from "bun:test";
import { createTestUser } from "@tearleads/bob-and-alice";
import { authenticate } from "../../test/helpers/authenticate";
import {
  bindForTest,
  buildBind,
  stageBlob,
} from "../../test/helpers/blobAttachmentKit";
import {
  bootstrapRoot,
  createDocument,
  createDocumentRequest,
  createSignedAccessEvent,
} from "../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../test/helpers/registerUser";
import { routeApp } from "../routeApp";

test("document creation rejects a UUID spelling that storage would change", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const documentId = "a2345678-1234-4567-89ab-123456789abc";
  const request = await createDocumentRequest({
    documentId: documentId.toUpperCase(),
    owner,
    root,
  });
  const post = (body: unknown) =>
    routeApp.request("/documents", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  const response = await post(request);
  expect(response.status).toBe(400);
  expect(await response.text()).toContain("canonical UUID");
  // The transaction also rolls back its live document and head reservation.
  const valid = await post(
    await createDocumentRequest({ documentId, owner, root }),
  );
  expect(valid.status).toBe(200);
  expect(await valid.json()).toMatchObject({ id: documentId });
});

test("attachment binding rejects a signed UUID alias before projecting it", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const document = await createDocument({ owner, root });
  const blobId = crypto.randomUUID();
  const bound = await buildBind({
    blobId,
    document,
    owner,
    root,
    stagedBlob: await stageBlob(owner, blobId),
  });
  const body = {
    ...bound.binding.body,
    bindingId: bound.binding.bindingId.toUpperCase(),
  };
  const event = await createSignedAccessEvent({
    body,
    dependencyManifestHashes:
      bound.binding.event.event.dependencyManifestHashes,
    objectId: blobId,
    objectKind: "blob",
    organizationId: bound.binding.event.event.organizationId,
    previousManifestHash: null,
    signer: owner,
  });
  await expect(
    bindForTest({
      blobId,
      owner,
      request: { ...bound.request, body, event: { ...event.event } },
    }),
  ).rejects.toMatchObject({
    status: 400,
    message: "Attachment binding id must be a canonical UUID",
  });
  // The staged bytes remain usable and the valid binding can still commit.
  await bindForTest({ blobId, owner, request: bound.request });
});
