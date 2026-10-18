import { expect, test } from "bun:test";
import {
  createFakePlan,
  createMultipartApi,
  DEFAULT_CHUNK_SIZE,
} from "../../../../test/helpers/multipartUpload";
import {
  BLOB_TRANSFER_CONCURRENCY,
  type BlobTransferPermit,
  tryAcquireBlobTransferPermit,
} from "../../../data/blobs/transferPool";
import {
  prepareFirstMultipartParts,
  releasePreparedParts,
} from "./multipartFirstParts";
import { stageMultipartBlobAttachment } from "./multipartUpload";

function takeFreePermits(client: object): BlobTransferPermit[] {
  const permits: BlobTransferPermit[] = [];
  for (;;) {
    const permit = tryAcquireBlobTransferPermit(client);
    if (!permit) return permits;
    permits.push(permit);
  }
}

// First parts are encrypted before their stage exists; their bytes count
// against the client's shared byte-I/O bound like any transfer in flight.
test("first parts describe only as many parts as the pool has free slots", async () => {
  const client = {};
  // Two other transfers are running; two slots remain.
  const [first, second, ...free] = takeFreePermits(client);
  const others = [first, second].filter((permit) => permit !== undefined);
  for (const permit of free) permit.release();

  const firstParts = await prepareFirstMultipartParts(
    client,
    createFakePlan({ partCount: 4 }),
    4,
  );
  expect(firstParts.descriptors.map((part) => part.partNumber)).toEqual([1, 2]);
  expect(tryAcquireBlobTransferPermit(client)).toBeNull();

  releasePreparedParts(firstParts.prepared);
  for (const permit of others) permit.release();
  expect(takeFreePermits(client)).toHaveLength(BLOB_TRANSFER_CONCURRENCY);
});

test("a failed initiation returns its first parts' pool slots", async () => {
  const apiClient = createMultipartApi({
    initiateMultipartBlobStage: async () => null,
  });

  await expect(
    stageMultipartBlobAttachment({
      apiClient,
      encryption: createFakePlan({ partCount: 4 }),
      multipart: { partSize: DEFAULT_CHUNK_SIZE },
      organizationId: "organization-1",
    }),
  ).rejects.toThrow("Multipart blob stage initiation failed");
  expect(takeFreePermits(apiClient)).toHaveLength(BLOB_TRANSFER_CONCURRENCY);
});
