import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  documentContentKeyEpochs,
  documentContentKeyTargets,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import { DOCUMENT_CONTENT_KEY_WRAP_SUITE } from "@tearleads/crypto";
import { isPlainObject } from "@tearleads/validators/isPlainObject";
import { eq } from "drizzle-orm";
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
  // Each case names the envelope diagnostic it must produce: a bare 400 would
  // also be returned by the coverage and signature guards that run first.
  const malformed = [
    {
      envelope: { ...target, wrappingMetadata: { suite: "test-wrap" } },
      expected: "Document content-key target metadata must contain exactly",
    },
    {
      envelope: {
        ...target,
        wrappingMetadata: { ...target.wrappingMetadata, suite: "test-wrap" },
      },
      expected: "Document content-key target uses an unknown suite",
    },
    {
      envelope: {
        ...target,
        wrappingMetadata: { ...target.wrappingMetadata, iv: "AA==" },
      },
      expected: "Document content-key target IV has an invalid encoded length",
    },
    {
      envelope: { ...target, wrappedKey: "AA==" },
      expected:
        "Document content-key target wrapped key has an invalid encoded length",
    },
    {
      envelope: { ...target, wrappedKey: `${target.wrappedKey}\n` },
      expected:
        "Document content-key target wrapped key has an invalid encoded length",
    },
  ];
  for (const { envelope, expected } of malformed) {
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
    const body = await response.text();
    expect({ status: response.status, body }).toMatchObject({ status: 400 });
    expect(body).toContain(expected);
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
    stagedBlob: await stageBlob(owner, blobId),
  });
  const target = request.contentKeyBundle.targets[0];
  if (!target) throw new Error("Expected blob target");
  const malformed = [
    {
      envelope: { ...target, wrappingMetadata: { suite: "test-wrap" } },
      expected: "Blob content-key target metadata must contain exactly",
    },
    {
      envelope: {
        ...target,
        wrappingMetadata: { ...target.wrappingMetadata, suite: "test-wrap" },
      },
      expected: "Blob content-key target uses an unknown suite",
    },
    {
      envelope: {
        ...target,
        wrappingMetadata: { ...target.wrappingMetadata, iv: "AA==" },
      },
      expected: "Blob content-key target IV has an invalid encoded length",
    },
    {
      envelope: { ...target, wrappedKey: "AA==" },
      expected:
        "Blob content-key target wrapped key has an invalid encoded length",
    },
    {
      envelope: { ...target, wrappedKey: `${target.wrappedKey}\n` },
      expected:
        "Blob content-key target wrapped key has an invalid encoded length",
    },
  ];
  for (const { envelope, expected } of malformed) {
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
    await expect(rejected).rejects.toThrow(expected);
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

// The submission gate's counterpart. Reads go through
// `assertStoredTargetsMatchCurrent`, which validates no envelope, so an
// unrecognized metadata key never makes a row unprojectable. This pins that:
// routing the projection through `assertSubmittedTargetsMatchCurrent` instead
// fails it with `document_projection_state_invalid`, and no client-side heal
// could reach that row.
test("a stored envelope with an unrecognized metadata key still projects", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const document = await createDocument({ owner, root });

  const [epoch] = await db
    .select({ id: documentContentKeyEpochs.id })
    .from(documentContentKeyEpochs)
    .where(eq(documentContentKeyEpochs.documentId, document.id));
  if (!epoch) throw new Error("Expected a stored content-key epoch");
  const [stored] = await db
    .select()
    .from(documentContentKeyTargets)
    .where(eq(documentContentKeyTargets.documentContentKeyEpochId, epoch.id));
  if (!stored) throw new Error("Expected a stored content-key target");
  const iv = isPlainObject(stored.wrappingMetadata)
    ? Reflect.get(stored.wrappingMetadata, "iv")
    : undefined;
  if (typeof iv !== "string") throw new Error("Expected a stored wrap IV");
  // The envelope stays decryptable; only an unrecognized key is added.
  await db
    .update(documentContentKeyTargets)
    .set({
      wrappingMetadata: {
        iv,
        suite: DOCUMENT_CONTENT_KEY_WRAP_SUITE,
        unrecognized: "carried",
      },
    })
    .where(eq(documentContentKeyTargets.id, stored.id));

  const projection = await routeApp.request(
    `/documents/${document.id}/writer-projection`,
    { headers: { Authorization: `Bearer ${owner.token}` } },
  );
  const body = await projection.text();
  expect({ status: projection.status, body }).toMatchObject({ status: 200 });
  expect(body).toContain('"unrecognized":"carried"');
});
