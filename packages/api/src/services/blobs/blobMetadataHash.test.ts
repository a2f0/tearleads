import { expect, test } from "bun:test";
import { blobs } from "@tearleads/api-shared/schema";
import { signWriteHeader } from "@tearleads/crypto";
import { createTestUser } from "@tearleads/test-utils";
import { eq } from "drizzle-orm";
import { authenticate } from "../../../test/helpers/authenticate";
import {
  bindForTest,
  blobAttachmentTestRuntime,
  buildBind,
  stageBlob,
} from "../../../test/helpers/blobAttachmentKit";
import {
  bootstrapRoot,
  createDocument,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../../test/helpers/registerUser";
import { readWriteHeader } from "../../workflows/blobs/mutations/records";

test("a writer cannot bind matching but false envelope and signed metadata hashes", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const document = await createDocument({ owner, root });
  const blobId = crypto.randomUUID();
  const metadataHash = "c".repeat(64);
  const { request } = await buildBind({
    blobId,
    document,
    owner,
    root,
    stagedBlob: await stageBlob(owner, blobId, { overrides: { metadataHash } }),
  });
  const staged = request.stagedBlob;
  if (!staged) throw new Error("Expected staged header");
  const { signature: _signature, ...unsigned } = readWriteHeader(
    staged.writeHeader,
    "test header",
  );
  const signed = await signWriteHeader(
    { ...unsigned, metadataHash },
    owner.signing.signingPrivateKey,
  );
  await expect(
    bindForTest({
      blobId,
      owner,
      request: {
        ...request,
        stagedBlob: { ...staged, writeHeader: { ...signed } },
      },
    }),
  ).rejects.toMatchObject({
    status: 400,
    message: "Blob encrypted envelope metadata hash is invalid",
  });
  expect(
    await blobAttachmentTestRuntime.db
      .select()
      .from(blobs)
      .where(eq(blobs.id, blobId)),
  ).toEqual([]);
  const retry = await buildBind({
    blobId,
    document,
    owner,
    root,
    stagedBlob: await stageBlob(owner, blobId),
  });
  await expect(
    bindForTest({ blobId, owner, request: retry.request }),
  ).resolves.toBeUndefined();
});

test("bind fixtures preserve a non-default content-key epoch", async () => {
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
    contentKeyEpoch: 2,
    stagedBlob: await stageBlob(owner, blobId, { contentKeyEpoch: 2 }),
  });
  await expect(
    bindForTest({ blobId, owner, request }),
  ).resolves.toBeUndefined();
});
