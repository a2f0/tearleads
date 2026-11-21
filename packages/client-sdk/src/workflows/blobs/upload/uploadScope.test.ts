import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { createMultipartBlobStageFixture } from "../../../../test/helpers/data/blobUploadFixtures";
import { createBlobAttachmentServiceFixture } from "../../../../test/helpers/workflows/blobAttachmentServiceFixture";
import { createMaterializedSyncFixture } from "../../../../test/helpers/workflows/materializedSyncFixture";
import type {
  MultipartUploadProgress,
  UploadDocumentAttachmentRequest,
} from "../../../data/blobs/attachments/types";
import type { BlobBytes } from "../../../data/blobs/blobContracts";

const MIB = 1024 * 1024;

/** Uploads `bytes` one part at a time, holding part 1 until the test releases it. */
async function pausableUpload(input: {
  readonly bytes: Uint8Array;
  readonly isRemoteSyncBlocked: UploadDocumentAttachmentRequest["isRemoteSyncBlocked"];
  readonly label: string;
  /** Runs while the stage request is in flight. */
  readonly duringStageRequest?: () => void;
}) {
  const fixture = await createMaterializedSyncFixture();
  const multipart = createMultipartBlobStageFixture();
  const firstPart = Promise.withResolvers<void>();
  const releaseFirstPart = Promise.withResolvers<void>();
  const calls = {
    binds: 0,
    parts: [] as number[],
    resolvedStages: 0,
    stages: 0,
  };
  const progress: MultipartUploadProgress[] = [];
  const { close, execSql } = await createTestExecSql(input.label);
  const uploaded = createBlobAttachmentServiceFixture({
    api: {
      ...multipart,
      bindBlobAttachment: async () => {
        calls.binds += 1;
        return null;
      },
      getDocumentWriterProjection: async () => fixture.writerProjection,
      initiateMultipartBlobStage: async (request) => {
        calls.stages += 1;
        input.duringStageRequest?.();
        return multipart.initiateMultipartBlobStage(request);
      },
      uploadMultipartBlobPartBytes: async (
        stageId,
        partNumber,
        request,
        options,
      ) => {
        calls.parts.push(partNumber);
        if (partNumber === 1) {
          firstPart.resolve();
          await releaseFirstPart.promise;
        }
        return multipart.uploadMultipartBlobPartBytes(
          stageId,
          partNumber,
          request,
          options,
        );
      },
    },
    encapsulationSecretKey: fixture.secretKey,
    execSql,
  })
    .uploadDocumentAttachment({
      author: fixture.author,
      bytes: input.bytes as BlobBytes,
      documentId: fixture.writerProjection.documentId,
      expectedBindingId: null,
      isRemoteSyncBlocked: input.isRemoteSyncBlocked,
      multipart: { partSize: 5 * MIB, uploadConcurrency: 1 },
      onMultipartProgress: (event) => progress.push(event),
      onStageResolved: () => {
        calls.resolvedStages += 1;
      },
      resolveProjectionUserKey: fixture.resolveProjectionUserKey,
      slotId: "paused-upload",
    })
    .finally(close);
  return {
    calls,
    firstPart: firstPart.promise,
    progress,
    releaseFirstPart: () => releaseFirstPart.resolve(),
    uploaded,
  };
}

test("an upload paused after its initial checks creates no stage", async () => {
  let checks = 0;
  const upload = await pausableUpload({
    bytes: new Uint8Array([1, 2, 3]),
    // The projection check passes; the organization pauses right after it.
    isRemoteSyncBlocked: () => {
      checks += 1;
      return checks > 1;
    },
    label: "upload-paused-before-stage",
  });
  upload.releaseFirstPart();
  expect(await upload.uploaded).toBeNull();
  expect(upload.calls).toEqual({
    binds: 0,
    parts: [],
    resolvedStages: 0,
    stages: 0,
  });
  expect(upload.progress).toEqual([]);
});

test("a pause during the stage request keeps the stage resumable", async () => {
  let paused = false;
  const upload = await pausableUpload({
    bytes: new Uint8Array([1, 2, 3]),
    duringStageRequest: () => {
      paused = true;
    },
    isRemoteSyncBlocked: () => paused,
    label: "upload-paused-during-stage",
  });
  upload.releaseFirstPart();
  expect(await upload.uploaded).toBeNull();
  // The created stage is recorded for resumption; no part is sent.
  expect(upload.calls).toEqual({
    binds: 0,
    parts: [],
    resolvedStages: 1,
    stages: 1,
  });
  expect(upload.progress.map((event) => event.partsCompleted)).toEqual([0]);
});

test("an upload paused during a part sends no later part", async () => {
  let paused = false;
  const upload = await pausableUpload({
    bytes: new Uint8Array(6 * MIB).fill(7),
    isRemoteSyncBlocked: () => paused,
    label: "upload-paused-during-part",
  });
  await upload.firstPart;
  paused = true;
  upload.releaseFirstPart();
  expect(await upload.uploaded).toBeNull();
  // Part 1 was sent before the pause, so it completes and is reported.
  expect(upload.calls).toEqual({
    binds: 0,
    parts: [1],
    resolvedStages: 1,
    stages: 1,
  });
  expect(upload.progress.map((event) => event.partsCompleted)).toEqual([0, 1]);
});
