import { expect, test } from "bun:test";
import { blobStages, blobs } from "@tearleads/api-shared/schema";
import { createTestUser, type TestUser } from "@tearleads/test-utils";
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
import {
  completeStageAsBind,
  firstPartOf,
} from "../../../test/helpers/blobStageParts";
import {
  bootstrapRoot,
  createDocument,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { getDefaultOrganizationId } from "../../../test/helpers/organizationMembership";
import { registerUser } from "../../../test/helpers/registerUser";
import { BlobObjectStoreError } from "../../adapters/blobObjectStore";
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
async function uploadPart(input: {
  readonly bytes: Uint8Array;
  readonly owner: TestUser;
  readonly partNumber: number;
  readonly stage: { readonly stageId: string; readonly uploadId: string };
}): Promise<void> {
  await uploadMultipartBlobPartBytes(runtime, {
    byteLength: input.bytes.byteLength,
    bytes: input.bytes,
    partNumber: input.partNumber,
    sha256: sha256Hex(input.bytes),
    stageId: input.stage.stageId,
    uploadId: input.stage.uploadId,
    userId: input.owner.userId,
  });
}

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
    await uploadPart({
      bytes:
        input.uploaded === "envelope" ? bytes : bytes.map((byte) => byte ^ 1),
      owner: input.owner,
      partNumber: 1,
      stage,
    });
  }
  return {
    bytes,
    key: `organizations/${organizationId}/blob-stages/${stage.stageId}`,
    stage,
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

// Completion assembles only parts 1..k covering the declared length: a stray
// part numbered past them cannot change, or poison, the object.
test("a bind ignores a stray part past the declared length", async () => {
  const { document, owner, root } = await bindScenario();
  const blobId = crypto.randomUUID();
  const { stage, stagedBlob } = await stageDeclaredEnvelope({
    blobId,
    owner,
    uploaded: "envelope",
  });
  await uploadPart({
    bytes: new Uint8Array([1, 2, 3]),
    owner,
    partNumber: 2,
    stage,
  });
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

test("a bind names a missing part without consuming the upload", async () => {
  const { document, owner, root } = await bindScenario();
  const blobId = crypto.randomUUID();
  const { bytes, stage, stagedBlob } = await stageDeclaredEnvelope({
    blobId,
    owner,
    uploaded: "nothing",
  });
  await uploadPart({ bytes, owner, partNumber: 2, stage });
  const { request } = await buildBind({
    blobId,
    document,
    owner,
    root,
    stagedBlob,
  });
  await expect(bindForTest({ blobId, owner, request })).rejects.toMatchObject({
    status: 409,
    message: "Blob multipart stage is missing part 1",
  });

  // The upload survives the refusal: sending the missing part completes it.
  await uploadPart({ bytes, owner, partNumber: 1, stage });
  await expect(
    bindForTest({ blobId, owner, request }),
  ).resolves.toBeUndefined();
  expect(await storedBlob(blobId)).toHaveLength(1);
});

// The completion that assembles the object digests it while the envelope
// header is observed, so a first bind never reads the object a second time.
test("a first bind reads the assembled object once", async () => {
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
  const store = runtime.blobObjectStore;
  const reads: string[] = [];
  runtime.blobObjectStore = {
    ...store,
    completeMultipartUpload: (input) => {
      reads.push(input.observe ? "completion observed" : "completion");
      return store.completeMultipartUpload(input);
    },
    getObjectStream: (key) => {
      reads.push("object read");
      return store.getObjectStream(key);
    },
  };
  try {
    await expect(
      bindForTest({ blobId, owner, request }),
    ).resolves.toBeUndefined();
  } finally {
    runtime.blobObjectStore = store;
  }
  expect(reads).toEqual(["completion observed"]);
  expect(await storedBlob(blobId)).toHaveLength(1);
});

// Two binds complete one stage at once. The second finds the upload consumed
// and no object yet, while the first finishes completing it. Re-reading the
// now-complete stage adopts that object, instead of reporting the stage gone
// (which would make the client discard it and upload the bytes again).
test("a completion racing another completion adopts the completed stage", async () => {
  const { owner } = await bindScenario();
  const blobId = crypto.randomUUID();
  const { stage, stagedBlob } = await stageDeclaredEnvelope({
    blobId,
    owner,
    uploaded: "envelope",
  });
  const input = { stageId: stage.stageId, userId: owner.userId };
  const store = runtime.blobObjectStore;
  let assembling = false;
  let releaseCompletion = () => {};
  const completionHeld = new Promise<void>((resolve) => {
    releaseCompletion = resolve;
  });
  let signalAssembling = () => {};
  const assemblingStarted = new Promise<void>((resolve) => {
    signalAssembling = resolve;
  });
  let first: ReturnType<typeof completeStageAsBind> = Promise.resolve(null);
  runtime.blobObjectStore = {
    ...store,
    completeMultipartUpload: async (completion) => {
      assembling = true;
      signalAssembling();
      await completionHeld;
      try {
        return await store.completeMultipartUpload(completion);
      } finally {
        assembling = false;
      }
    },
    // The racing read lands while the first completion is still assembling,
    // and that completion then finishes before the racer looks again.
    getObjectStream: async (key) => {
      if (!assembling) return store.getObjectStream(key);
      releaseCompletion();
      await first;
      return null;
    },
    listParts: (parts) =>
      assembling
        ? Promise.reject(
            new BlobObjectStoreError(
              "Multipart upload not found",
              "multipart_upload_not_found",
            ),
          )
        : store.listParts(parts),
  };
  try {
    first = completeStageAsBind(runtime, input);
    await assemblingStarted;
    const racing = await completeStageAsBind(runtime, input);
    expect(racing).toMatchObject({ sha256: stagedBlob.sha256 });
    await expect(first).resolves.toMatchObject({ sha256: stagedBlob.sha256 });
  } finally {
    releaseCompletion();
    runtime.blobObjectStore = store;
  }
});

// The stage is complete once its digest matches; the envelope is judged after.
// A malformed envelope is refused without un-completing the stage, so a retry
// reads the same object and is refused the same way rather than reassembling.
test("a bind refuses a malformed envelope after completing its stage", async () => {
  const { document, owner, root } = await bindScenario();
  const organizationId = await getDefaultOrganizationId(owner.userId);
  const blobId = crypto.randomUUID();
  const bytes = new Uint8Array(64).fill(7);
  const stage = await initiateMultipartBlobStage(runtime, {
    organizationId,
    byteLength: bytes.byteLength,
    firstParts: firstPartOf(bytes),
    sha256: sha256Hex(bytes),
    userId: owner.userId,
  });
  await uploadPart({ bytes, owner, partNumber: 1, stage });
  const { request } = await buildBind({
    blobId,
    document,
    owner,
    root,
    stagedBlob: { sha256: sha256Hex(bytes), stageId: stage.stageId },
  });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await expect(bindForTest({ blobId, owner, request })).rejects.toMatchObject(
      { status: 400 },
    );
    const [row] = await runtime.db
      .select({ completedAt: blobStages.completedAt })
      .from(blobStages)
      .where(eq(blobStages.id, stage.stageId));
    expect(row?.completedAt).not.toBeNull();
  }
  expect(await storedBlob(blobId)).toEqual([]);
});
