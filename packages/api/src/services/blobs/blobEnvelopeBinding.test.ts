import { expect, test } from "bun:test";
import { blobs } from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import { signWriteHeader } from "@tearleads/crypto";
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

// Each of the five bound fields gets its own case. The "another blob" fixture
// above moves blobId, contentRecordId, metadataHash and nonceDomainHash
// together, so it would still pass with any one comparison deleted; these
// vary exactly one field each, so each comparison is load-bearing.
for (const [field, override] of [
  ["blobId", { blobId: "33333333-3333-4333-8333-333333333333" }],
  ["contentKeyEpoch", { contentKeyEpoch: 2 }],
  [
    "contentRecordId",
    {
      contentRecordId: "44444444-4444-4444-8444-444444444444",
    },
  ],
  ["metadataHash", { metadataHash: "c".repeat(64) }],
  ["nonceDomainHash", { nonceDomainHash: "d".repeat(64) }],
] as const) {
  test(`an envelope whose ${field} alone differs is refused`, async () => {
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
      stagedBlob: await stageBlob(owner, blobId, { overrides: override }),
    });
    await expect(bindForTest({ blobId, owner, request })).rejects.toMatchObject(
      {
        status: 400,
        message:
          "Blob encrypted envelope does not match its signed write header",
      },
    );
  });
}

// The unit tests drive `summarizeBlobEnvelopeStage` directly. This drives the
// service, so it also proves prevalidation is wired in before promotion.
test("staged bytes that are not an envelope are refused before promotion", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const document = await createDocument({ owner, root });
  const blobId = crypto.randomUUID();
  // Signed correctly over its own hash, so the envelope is the only thing wrong.
  const { request: rejected } = await buildBind({
    blobId,
    document,
    owner,
    root,
    stagedBlob: await stageBlob(owner, blobId, {
      bytes: new Uint8Array(64).fill(1),
    }),
  });
  await expect(
    bindForTest({ blobId, owner, request: rejected }),
  ).rejects.toMatchObject({
    status: 400,
    message: "Blob encrypted bytes magic is invalid",
  });
  expect(
    await blobAttachmentTestRuntime.db
      .select()
      .from(blobs)
      .where(eq(blobs.id, blobId)),
  ).toEqual([]);

  const { request } = await buildBind({
    blobId,
    document,
    owner,
    root,
    stagedBlob: await stageBlob(owner, blobId),
  });
  await expect(
    bindForTest({ blobId, owner, request }),
  ).resolves.toBeUndefined();
});
