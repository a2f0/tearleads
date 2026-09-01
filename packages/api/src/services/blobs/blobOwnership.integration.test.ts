import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { attachmentBindings, blobs } from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import { eq } from "drizzle-orm";
import { authenticate } from "../../../test/helpers/authenticate";
import {
  bindForTest,
  buildBind,
  buildDetach,
  detachForTest,
  stageBlob,
} from "../../../test/helpers/blobAttachmentKit";
import {
  bootstrapRoot,
  createDocument,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../../test/helpers/registerUser";

test("a cross-organization bind cannot revive a dereferenced blob", async () => {
  const sourceOwner = createTestUser();
  const targetOwner = createTestUser();
  await registerUser(sourceOwner);
  await registerUser(targetOwner);
  await authenticate(sourceOwner);
  await authenticate(targetOwner);

  const sourceRoot = await bootstrapRoot(sourceOwner);
  const sourceDocument = await createDocument({
    owner: sourceOwner,
    root: sourceRoot,
  });
  const blobId = crypto.randomUUID();
  const sourceBind = await buildBind({
    blobId,
    document: sourceDocument,
    owner: sourceOwner,
    root: sourceRoot,
    stagedBlob: await stageBlob(sourceOwner),
  });
  await bindForTest({
    blobId,
    owner: sourceOwner,
    request: sourceBind.request,
  });
  await detachForTest({
    binding: sourceBind.binding,
    blobId,
    owner: sourceOwner,
    request: await buildDetach({
      binding: sourceBind.binding,
      document: sourceDocument,
      owner: sourceOwner,
      root: sourceRoot,
    }),
  });
  const [before] = await db
    .select({ dereferencedAt: blobs.dereferencedAt })
    .from(blobs)
    .where(eq(blobs.id, blobId));
  expect(before?.dereferencedAt).toBeInstanceOf(Date);

  const targetRoot = await bootstrapRoot(targetOwner);
  const targetDocument = await createDocument({
    owner: targetOwner,
    root: targetRoot,
  });
  const targetBind = await buildBind({
    blobId,
    document: targetDocument,
    owner: targetOwner,
    root: targetRoot,
  });
  const unknownBind = await buildBind({
    blobId: crypto.randomUUID(),
    document: targetDocument,
    owner: targetOwner,
    root: targetRoot,
  });
  const withUnknownTarget = (
    request: typeof targetBind.request,
  ): typeof targetBind.request => ({
    ...request,
    contentKeyBundle: {
      ...request.contentKeyBundle,
      targets: request.contentKeyBundle.targets.map((target) => ({
        ...target,
        containerId: crypto.randomUUID(),
      })),
    },
  });
  await expect(
    bindForTest({
      blobId,
      owner: targetOwner,
      request: withUnknownTarget(targetBind.request),
    }),
  ).rejects.toMatchObject({
    message: "Blob content-key target heads are stale",
    status: 409,
  });
  await expect(
    bindForTest({
      blobId: unknownBind.binding.blobId,
      owner: targetOwner,
      request: withUnknownTarget(unknownBind.request),
    }),
  ).rejects.toMatchObject({
    message: "Blob content-key target heads are stale",
    status: 409,
  });
  await expect(
    bindForTest({
      blobId,
      owner: targetOwner,
      request: targetBind.request,
    }),
  ).rejects.toMatchObject({ message: "Blob not found", status: 404 });

  const [after] = await db
    .select({ dereferencedAt: blobs.dereferencedAt })
    .from(blobs)
    .where(eq(blobs.id, blobId));
  const targetBindings = await db
    .select({ id: attachmentBindings.id })
    .from(attachmentBindings)
    .where(eq(attachmentBindings.documentId, targetDocument.id));
  expect(after?.dereferencedAt?.getTime()).toBe(
    before?.dereferencedAt?.getTime(),
  );
  expect(targetBindings).toEqual([]);
});
