import { expect, test } from "bun:test";
import { runBlobTransfer } from "../../data/blobs/transferPool";
import { stageMultipartBlobAttachment } from "./multipartUpload";
import {
  createFakePlan,
  createMultipartApi,
  DEFAULT_CHUNK_SIZE,
} from "./multipartUploadTestHelpers";

for (const failure of ["throw", "null"] as const) {
  test(`a ${failure} part failure cancels queued parts before returning its permit`, async () => {
    const encrypted: number[] = [];
    const uploaded: number[] = [];
    let completed = false;
    const apiClient = createMultipartApi({
      uploadMultipartBlobPartBytes: async (_stageId, partNumber) => {
        uploaded.push(partNumber);
        if (failure === "throw") throw new Error("first part failed");
        return null;
      },
      completeMultipartBlobStage: async () => {
        completed = true;
        return null;
      },
    });
    let release = () => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    // Other documents hold three permits. Only part one can start, with its
    // sibling queued directly behind it in the shared transfer pool.
    const otherDocuments = Array.from({ length: 3 }, () =>
      runBlobTransfer(apiClient, () => blocked),
    );
    try {
      await expect(
        stageMultipartBlobAttachment({
          apiClient,
          organizationId: "organization-1",
          encryption: createFakePlan({
            partCount: 4,
            encryptPart: async (index, length) => {
              encrypted.push(index);
              return new Uint8Array(length);
            },
          }),
          multipart: { partSize: DEFAULT_CHUNK_SIZE, uploadConcurrency: 2 },
        }),
      ).rejects.toThrow(
        failure === "throw" ? "first part failed" : "part 1 upload failed",
      );
      expect(encrypted).toEqual([0]);
      expect(uploaded).toEqual([1]);
      expect(completed).toBe(false);
    } finally {
      release();
      await Promise.all(otherDocuments);
    }
  });
}
