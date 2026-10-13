import { expect, spyOn, test } from "bun:test";
import {
  createFakePlan,
  createMultipartApi,
  DEFAULT_CHUNK_SIZE,
} from "../../../test/helpers/multipartUpload";
import { runBlobTransfer } from "../../data/blobs/transferPool";
import { stageMultipartBlobAttachment } from "./multipartUpload";

test("multipart timeout aborts its transport and ignores a late successful part", async () => {
  const timers = spyOn(globalThis, "setTimeout");
  let release = () => {};
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started = () => {};
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  let signal: AbortSignal | undefined;
  const progress: number[] = [];
  const apiClient = createMultipartApi({
    uploadMultipartBlobPartBytes: async (
      stageId,
      partNumber,
      request,
      options,
    ) => {
      signal = options?.signal;
      started();
      await blocked;
      return {
        stageId,
        uploadId: request.uploadId,
        part: { partNumber, etag: "late", byteLength: request.byteLength },
      };
    },
  });
  const upload = stageMultipartBlobAttachment({
    apiClient,
    encryption: createFakePlan({ partCount: 1 }),
    organizationId: "organization-1",
    multipart: { partSize: DEFAULT_CHUNK_SIZE },
    onMultipartProgress: ({ partsCompleted }) => {
      progress.push(partsCompleted);
    },
  });
  const outcome = upload.then(
    () => null,
    (error: unknown) => error,
  );
  try {
    await entered;
    const timer = timers.mock.calls.findLast(([, delay]) => delay === 120_000);
    if (!timer || typeof timer[0] !== "function")
      throw new Error("Missing transfer deadline");
    timer[0]();
    expect(await outcome).toEqual(new Error("Blob transfer timed out"));
    expect(signal?.aborted).toBe(true);
    expect(await runBlobTransfer(apiClient, async () => "healthy")).toBe(
      "healthy",
    );
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(progress).toEqual([0]);
  } finally {
    release();
    timers.mockRestore();
    await Promise.allSettled([upload, outcome]);
  }
});
