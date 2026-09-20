import { expect, test } from "bun:test";
import { createTestUser } from "@tearleads/bob-and-alice";
import { authenticate } from "../../../test/helpers/authenticate";
import {
  blobAttachmentTestRuntime,
  buildBind,
  stageBlob,
} from "../../../test/helpers/blobAttachmentKit";
import {
  bootstrapRoot,
  createDocument,
  createDocumentRequest,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";
import {
  BlobMutationError,
  bindBlobAttachment,
} from "../../services/blobs/blobMutations";

test("document creation rejects malformed key envelopes without consuming the signed event", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const request = await createDocumentRequest({ owner, root });
  const target = request.contentKeyBundle.targets[0];
  if (!target) throw new Error("Expected document target");
  const malformed = [
    { ...target, wrappingMetadata: { suite: "test-wrap" } },
    { ...target, wrappingMetadata: { ...target.wrappingMetadata, iv: "AA==" } },
    { ...target, wrappedKey: "AA==" },
    { ...target, wrappedKey: `${target.wrappedKey}\n` },
  ];
  for (const envelope of malformed) {
    const response = await routeApp.request("/documents", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...request,
        contentKeyBundle: { ...request.contentKeyBundle, targets: [envelope] },
      }),
    });
    expect(response.status, await response.clone().text()).toBe(400);
  }
  const accepted = await routeApp.request("/documents", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${owner.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });
  expect(accepted.status, await accepted.clone().text()).toBe(200);
});

test("blob binding rejects malformed key envelopes without promoting or consuming the stage", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const document = await createDocument({ owner, root });
  const blobId = crypto.randomUUID();
  const { request } = await buildBind({
    owner,
    root,
    document,
    blobId,
    stagedBlob: await stageBlob(owner),
  });
  const target = request.contentKeyBundle.targets[0];
  if (!target) throw new Error("Expected blob target");
  const malformed = [
    { ...target, wrappingMetadata: { suite: "test-wrap" } },
    { ...target, wrappingMetadata: { ...target.wrappingMetadata, iv: "AA==" } },
    { ...target, wrappedKey: "AA==" },
    { ...target, wrappedKey: `${target.wrappedKey}\n` },
  ];
  for (const envelope of malformed) {
    const rejected = bindBlobAttachment(blobAttachmentTestRuntime, {
      blobId,
      userId: owner.userId,
      fingerprint: owner.fingerprint,
      sessionId: "envelope-validation",
      request: {
        ...request,
        contentKeyBundle: { ...request.contentKeyBundle, targets: [envelope] },
      },
    });
    await expect(rejected).rejects.toBeInstanceOf(BlobMutationError);
    await expect(rejected).rejects.toMatchObject({ status: 400 });
  }
  const accepted = await bindBlobAttachment(blobAttachmentTestRuntime, {
    blobId,
    userId: owner.userId,
    fingerprint: owner.fingerprint,
    sessionId: "envelope-validation",
    request,
  });
  expect(accepted.blobId).toBe(blobId);
});
