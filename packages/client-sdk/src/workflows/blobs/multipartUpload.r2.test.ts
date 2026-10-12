import { expect, test } from "bun:test";
import { bytesToHex, createIncrementalSha256 } from "@tearleads/crypto";
import type { MultipartBlobStagePart } from "@tearleads/validators/response";
import { deriveBlobContentRecordKey } from "../../data/documents/blob/shared/blobRecordCrypto";
import { prepareBlobEncryption } from "../../data/documents/blob/shared/crypto";
import { parseBlobEncryptedBytes } from "../../data/documents/blob/shared/readers";
import type { BlobAttachmentApi } from "../../data/documents/blob/shared/types";
import { importContentKeyMaterial } from "../../data/documents/shared/contentRecordKeys";
import { decryptBlobChunks } from "./blobChunkDecryption";
import { stageMultipartBlobAttachment } from "./multipartUpload";

const chunkSize = 5 * 1024 * 1024;
const organizationId = "22222222-2222-4222-8222-222222222222";

test("resumes R2 multipart uploads with equal nonfinal parts and intact ciphertext", async () => {
  const encryption = await prepareBlobEncryption({
    blobId: "11111111-1111-4111-8111-111111111111",
    organizationId,
    contentKey: new Uint8Array(32).fill(7),
    contentKeyBundle: { contentKeyEpoch: 1, targetHash: "test", targets: [] },
    nonceSeed: new Uint8Array(12).fill(9),
    source: {
      byteLength: chunkSize * 3 + 123,
      async read(offset, length) {
        expect(length).toBeLessThanOrEqual(chunkSize);
        return Uint8Array.from(
          { length },
          (_, index) => (offset + index) % 251,
        );
      },
    },
  });
  const payloads = new Map<number, Uint8Array<ArrayBuffer>>();
  const parts = new Map<number, MultipartBlobStagePart>();
  const uploads: number[] = [];
  let interrupted = false;
  const stage = {
    organizationId,
    stageId: "stage-r2",
    uploadId: "upload-r2",
    byteLength: encryption.byteLength,
    sha256: encryption.sha256,
    expiresAt: "2099-01-01T00:00:00Z",
  };
  const api: BlobAttachmentApi = {
    bindBlobAttachment: async () => null,
    getDocumentWriterProjection: async () => null,
    initiateMultipartBlobStage: async () => ({ ...stage, uploadedParts: [] }),
    getMultipartBlobStage: async () => ({
      ...stage,
      completed: false,
      uploadedParts: [...parts.values()],
    }),
    async uploadMultipartBlobPartBytes(_id, partNumber, request) {
      uploads.push(partNumber);
      if (partNumber === 2 && !interrupted) {
        interrupted = true;
        throw new Error("connection interrupted");
      }
      if (!(request.encryptedBytes instanceof Uint8Array))
        throw new Error("Expected binary upload");
      const bytes = new Uint8Array(request.encryptedBytes);
      const hash = createIncrementalSha256();
      hash.update(bytes);
      expect(bytesToHex(hash.digest())).toBe(request.sha256);
      const part = {
        partNumber,
        byteLength: request.byteLength,
        etag: `etag-${partNumber}`,
      };
      parts.set(partNumber, part);
      payloads.set(partNumber, bytes);
      return { ...stage, part };
    },
    async completeMultipartBlobStage(_id, request) {
      const lengths = request.parts.map(
        ({ partNumber }) => parts.get(partNumber)?.byteLength,
      );
      for (const length of lengths.slice(0, -1)) {
        expect(length).toBeGreaterThanOrEqual(chunkSize);
        expect(length).toBe(lengths[0]);
      }
      const ciphertext = new Uint8Array(encryption.byteLength);
      let offset = 0;
      for (const { partNumber } of request.parts) {
        const bytes = payloads.get(partNumber);
        if (!bytes) throw new Error("Missing multipart payload");
        ciphertext.set(bytes, offset);
        offset += bytes.byteLength;
      }
      expect(offset).toBe(encryption.byteLength);
      const hash = createIncrementalSha256();
      hash.update(ciphertext);
      expect(bytesToHex(hash.digest())).toBe(encryption.sha256);
      const encrypted = parseBlobEncryptedBytes(ciphertext);
      expect(encrypted.chunkCount).toBe(4);
      const recordKey = await deriveBlobContentRecordKey({
        blobId: encrypted.blobId,
        contentRecordId: encrypted.contentRecordId,
        contentKeyEpoch: encrypted.contentKeyEpoch,
        contentKeyMaterial: await importContentKeyMaterial(
          new Uint8Array(32).fill(7),
        ),
        organizationId,
        usage: "decrypt",
      });
      const plaintext = await decryptBlobChunks({
        encrypted,
        recordKey,
        organizationId,
        expectedBlobId: encrypted.blobId,
      });
      expect(plaintext.byteLength).toBe(chunkSize * 3 + 123);
      expect(plaintext.every((byte, index) => byte === index % 251)).toBe(true);
      return stage;
    },
  };
  const input = { apiClient: api, encryption, organizationId };
  await expect(
    stageMultipartBlobAttachment({
      ...input,
      multipart: { partSize: chunkSize, uploadConcurrency: 1 },
    }),
  ).rejects.toThrow("connection interrupted");
  expect(uploads).toEqual([1, 2]);
  uploads.length = 0;
  const resumed = await stageMultipartBlobAttachment({
    ...input,
    multipart: {
      partSize: chunkSize,
      resumeStageId: stage.stageId,
      uploadConcurrency: 1,
    },
  });
  expect(resumed).toBe(stage.stageId);
  expect(uploads).toEqual([2, 3]);
});
