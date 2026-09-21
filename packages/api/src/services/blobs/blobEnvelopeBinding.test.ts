import { expect, test } from "bun:test";
import { createTestUser } from "@tearleads/bob-and-alice";
import { signWriteHeader } from "@tearleads/crypto";
import { authenticate } from "../../../test/helpers/authenticate";
import {
  bindForTest,
  buildBind,
  stageBlob,
} from "../../../test/helpers/blobAttachmentKit";
import {
  bootstrapRoot,
  createDocument,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../../test/helpers/registerUser";
import { readWriteHeader } from "../../workflows/blobs/mutations/records";

test("a signed metadata mismatch rolls back the bind and permits a correct retry", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const document = await createDocument({ owner, root });
  const blobId = crypto.randomUUID();
  const { request } = await buildBind({
    blobId,
    document,
    owner,
    root,
    stagedBlob: await stageBlob(owner, blobId),
  });
  const staged = request.stagedBlob;
  if (!staged) throw new Error("Expected staged write header");
  const { signature: _signature, ...unsigned } = readWriteHeader(
    staged.writeHeader,
    "test header",
  );
  const mismatched = await signWriteHeader(
    { ...unsigned, metadataHash: "0".repeat(64) },
    owner.signing.signingPrivateKey,
  );
  await expect(
    bindForTest({
      blobId,
      owner,
      request: {
        ...request,
        stagedBlob: { ...staged, writeHeader: { ...mismatched } },
      },
    }),
  ).rejects.toMatchObject({
    status: 400,
    message: "Blob encrypted envelope does not match its signed write header",
  });
  await expect(
    bindForTest({ blobId, owner, request }),
  ).resolves.toBeUndefined();
});

test("an envelope for another blob cannot be promoted under a valid signed bind", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const document = await createDocument({ owner, root });
  const blobId = crypto.randomUUID();
  const { request } = await buildBind({
    blobId,
    document,
    owner,
    root,
    stagedBlob: await stageBlob(owner, crypto.randomUUID()),
  });
  await expect(bindForTest({ blobId, owner, request })).rejects.toMatchObject({
    status: 400,
    message: "Blob encrypted envelope does not match its signed write header",
  });
});
