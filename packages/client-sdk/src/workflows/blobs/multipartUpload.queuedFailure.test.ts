import { expect, test } from "bun:test";
import {
  createFakePlan,
  createMultipartApi,
  DEFAULT_CHUNK_SIZE,
} from "../../../test/helpers/multipartUpload";
import { runBlobTransfer } from "../../data/blobs/transferPool";
import { stageMultipartBlobAttachment } from "./multipartUpload";

for (const failure of ["throw", "null"] as const) {
  test(`a ${failure} part failure cancels queued parts before returning its permit`, async () => {
    const encrypted: number[] = [];
    const uploaded: number[] = [];
    const apiClient = createMultipartApi({
      uploadMultipartBlobPartBytes: async (_stageId, partNumber) => {
        uploaded.push(partNumber);
        if (failure === "throw") throw new Error("first part failed");
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
      // A first part's bytes hold a pool slot from description to upload, so
      // with one slot free only part one is described and encrypted; the
      // queued sibling is never encrypted beyond the shared bound.
      expect(encrypted).toEqual([0]);
      expect(uploaded).toEqual([1]);
    } finally {
      release();
      await Promise.all(otherDocuments);
    }
  });
}
