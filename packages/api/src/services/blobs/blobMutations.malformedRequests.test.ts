import { expect, test } from "bun:test";
import { createTestUser } from "@tearleads/test-utils";
import {
  bootstrapRoot,
  buildBindRequest,
  createDocumentFixture,
  registerOnly,
  runtime,
  stageEncryptedBlob,
} from "../../../test/helpers/blobMutationFixtures";
import { BlobMutationError, bindBlobAttachment } from "./blobMutations";

test("bindBlobAttachment rejects malformed signed event records", async () => {
  const owner = createTestUser();
  await registerOnly(owner);
  const container = await bootstrapRoot(owner);
  const document = await createDocumentFixture({ container, owner });

  const blobId = crypto.randomUUID();
  const malformedBind = await buildBindRequest({
    blobId,
    container,
    document,
    expectedBindingId: null,
    owner,
    slotId: "slot-a",
  });
  malformedBind.request.event = {
    ...malformedBind.request.event,
    version: "2",
  };

  await expect(
    bindBlobAttachment(runtime, {
      blobId: malformedBind.verifiedBinding.blobId,
      fingerprint: owner.fingerprint,
      request: malformedBind.request,
      sessionId: "test-session",
      userId: owner.userId,
    }),
  ).rejects.toMatchObject(
    new BlobMutationError("Blob event.version is invalid", 400),
  );
});

test("bindBlobAttachment rejects malformed staged blob write headers", async () => {
  const owner = createTestUser();
  await registerOnly(owner);
  const container = await bootstrapRoot(owner);
  const document = await createDocumentFixture({ container, owner });

  const blobId = crypto.randomUUID();
  const malformedBind = await buildBindRequest({
    blobId,
    container,
    document,
    expectedBindingId: null,
    owner,
    slotId: "slot-a",
    stagedBlob: await stageEncryptedBlob({
      blobId,
      owner,
    }),
  });
  if (!malformedBind.request.stagedBlob) {
    throw new Error("Expected staged blob request");
  }
  malformedBind.request.stagedBlob.writeHeader = {
    ...malformedBind.request.stagedBlob.writeHeader,
    version: "2",
  };

  await expect(
    bindBlobAttachment(runtime, {
      blobId: malformedBind.verifiedBinding.blobId,
      fingerprint: owner.fingerprint,
      request: malformedBind.request,
      sessionId: "test-session",
      userId: owner.userId,
    }),
  ).rejects.toMatchObject(
    new BlobMutationError("Blob write header.version is invalid", 400),
  );
});
