import { expect, test } from "bun:test";
import { blobStages, blobs } from "@tearleads/api-shared/schema";
import { createTestUser, type TestUser } from "@tearleads/bob-and-alice";
import { eq } from "drizzle-orm";
import { authenticate } from "../../../test/helpers/authenticate";
import {
  bindForTest,
  blobAttachmentTestRuntime,
  buildBind,
  stageBlob,
} from "../../../test/helpers/blobAttachmentKit";
import { createBlobEnvelopeFixture } from "../../../test/helpers/blobEnvelope";
import { readBlobObjectText } from "../../../test/helpers/blobObjectStore";
import { firstPartOf } from "../../../test/helpers/blobStageParts";
import {
  bootstrapRoot,
  createDocument,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { getDefaultOrganizationId } from "../../../test/helpers/organizationMembership";
import { registerUser } from "../../../test/helpers/registerUser";
import { sha256Hex } from "../../utils/sha256";
import {
  initiateMultipartBlobStage,
  uploadMultipartBlobPartBytes,
} from "./multipartStage";

const runtime = blobAttachmentTestRuntime;

async function bindScenario() {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const document = await createDocument({ owner, root });
  return { document, owner, root };
}

// Stage a real envelope's declared size and digest, uploading `uploaded`
// (or nothing) as its only part.
async function stageDeclaredEnvelope(input: {
  readonly blobId: string;
  readonly owner: TestUser;
  readonly uploaded: "envelope" | "nothing" | "tampered";
}) {
  const organizationId = await getDefaultOrganizationId(input.owner.userId);
  const { bytes } = await createBlobEnvelopeFixture({
    blobId: input.blobId,
    organizationId,
  });
  const sha256 = sha256Hex(bytes);
  const stage = await initiateMultipartBlobStage(runtime, {
    organizationId,
    byteLength: bytes.byteLength,
    firstParts: firstPartOf(bytes),
    sha256,
    userId: input.owner.userId,
  });
  if (input.uploaded !== "nothing") {
    const partBytes =
      input.uploaded === "envelope" ? bytes : bytes.map((byte) => byte ^ 1);
    await uploadMultipartBlobPartBytes(runtime, {
      byteLength: partBytes.byteLength,
      bytes: partBytes,
      partNumber: 1,
      sha256: sha256Hex(partBytes),
      stageId: stage.stageId,
      uploadId: stage.uploadId,
      userId: input.owner.userId,
    });
  }
  return {
    key: `organizations/${organizationId}/blob-stages/${stage.stageId}`,
    stagedBlob: { sha256, stageId: stage.stageId },
  };
}

async function storedBlob(blobId: string) {
  return runtime.db.select().from(blobs).where(eq(blobs.id, blobId));
}

test("a bind assembles and promotes a stage nobody completed", async () => {
  const { document, owner, root } = await bindScenario();
  const blobId = crypto.randomUUID();
  const stagedBlob = await stageBlob(owner, blobId);
  const [pending] = await runtime.db
    .select({ completedAt: blobStages.completedAt })
    .from(blobStages)
    .where(eq(blobStages.id, stagedBlob.stageId));
  expect(pending?.completedAt).toBeNull();

  const { request } = await buildBind({
    blobId,
    document,
    owner,
    root,
    stagedBlob,
  });
  await expect(
    bindForTest({ blobId, owner, request }),
  ).resolves.toBeUndefined();
  expect(await storedBlob(blobId)).toHaveLength(1);
});

test("a bind refuses a stage with no uploaded parts", async () => {
  const { document, owner, root } = await bindScenario();
  const blobId = crypto.randomUUID();
  const { stagedBlob } = await stageDeclaredEnvelope({
    blobId,
    owner,
    uploaded: "nothing",
  });
  const { request } = await buildBind({
    blobId,
    document,
    owner,
    root,
    stagedBlob,
  });
  await expect(bindForTest({ blobId, owner, request })).rejects.toMatchObject({
    status: 409,
    message: "Blob multipart stage has no uploaded parts",
  });
  expect(await storedBlob(blobId)).toEqual([]);
});

test("a bind refuses and deletes assembled bytes that miss the declared digest", async () => {
  const { document, owner, root } = await bindScenario();
  const blobId = crypto.randomUUID();
  const { key, stagedBlob } = await stageDeclaredEnvelope({
    blobId,
    owner,
    uploaded: "tampered",
  });
  const { request } = await buildBind({
    blobId,
    document,
    owner,
    root,
    stagedBlob,
  });
  await expect(bindForTest({ blobId, owner, request })).rejects.toMatchObject({
    status: 409,
    message: "Blob sha256 does not match multipart upload",
  });
  expect(await storedBlob(blobId)).toEqual([]);
  expect(await readBlobObjectText(runtime.blobObjectStore, key)).toBeNull();
});

test("a bind retried after it completed the stage promotes the same bytes", async () => {
  const { document, owner, root } = await bindScenario();
  const blobId = crypto.randomUUID();
  const { stagedBlob } = await stageDeclaredEnvelope({
    blobId,
    owner,
    uploaded: "envelope",
  });
  const { request } = await buildBind({
    blobId,
    document,
    owner,
    root,
    stagedBlob,
  });
  // The first attempt completes the stage, then its transaction is refused.
  const { stagedBlob: staged } = request;
  if (!staged) throw new Error("Expected a staged blob");
  await expect(
    bindForTest({
      blobId,
      owner,
      request: {
        ...request,
        contentKeyBundle: {
          ...request.contentKeyBundle,
          targetHash: "0".repeat(64),
        },
      },
    }),
  ).rejects.toMatchObject({
    message: "Blob content-key target hash mismatch",
  });
  const [completed] = await runtime.db
    .select({ completedAt: blobStages.completedAt })
    .from(blobStages)
    .where(eq(blobStages.id, staged.stageId));
  expect(completed?.completedAt).not.toBeNull();
  await expect(
    bindForTest({ blobId, owner, request }),
  ).resolves.toBeUndefined();
  expect(await storedBlob(blobId)).toHaveLength(1);
});
