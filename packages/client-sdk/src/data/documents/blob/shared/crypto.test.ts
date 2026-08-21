import { describe, expect, test } from "bun:test";
import { bytesToHex, createAesGcmIv } from "@symcrypt/crypto";
import type { BlobContentKeyBundleRequest } from "@symcrypt/validators/request";
import { type BlobBytes, createBlobByteSource } from "../../../blobContracts";
import { deriveBlobBaseIv } from "./blobRecordCrypto";
import { DEFAULT_BLOB_CHUNK_SIZE_BYTES, prepareBlobEncryption } from "./crypto";
import { parseBlobEncryptedBytes } from "./readers";

const contentKeyBundle: BlobContentKeyBundleRequest = {
  contentKeyEpoch: 1,
  targetHash: "target-hash",
  targets: [],
};

function fixedInput(bytes: BlobBytes) {
  return {
    blobId: "11111111-1111-4111-8111-111111111111",
    contentKey: new Uint8Array(32).fill(7),
    contentKeyBundle,
    organizationId: "org-1",
    source: createBlobByteSource(bytes),
  };
}

async function materialize(
  plan: Awaited<ReturnType<typeof prepareBlobEncryption>>,
): Promise<BlobBytes> {
  const bytes = new Uint8Array(plan.byteLength);
  let offset = 0;
  for (let index = 0; index < plan.partCount; index += 1) {
    const part = await plan.encryptPart(index);
    expect(part.byteLength).toBe(plan.getPartByteLength(index));
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  expect(offset).toBe(plan.byteLength);
  return bytes;
}

async function sha256Hex(bytes: BlobBytes): Promise<string> {
  return bytesToHex(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  );
}

function replaceAscii(bytes: BlobBytes, from: string, to: string): BlobBytes {
  expect(to.length).toBe(from.length);
  const result = bytes.slice();
  const expected = new TextEncoder().encode(from);
  const replacement = new TextEncoder().encode(to);
  const offset = result.findIndex((_, index) =>
    expected.every((byte, byteIndex) => result[index + byteIndex] === byte),
  );
  expect(offset).toBeGreaterThanOrEqual(0);
  result.set(replacement, offset);
  return result;
}

describe("prepareBlobEncryption", () => {
  test("reproduces identical binary parts for the same nonce seed", async () => {
    const bytes = new TextEncoder().encode("resumable attachment bytes");
    const nonceSeed = createAesGcmIv();
    const first = await prepareBlobEncryption({
      ...fixedInput(bytes),
      nonceSeed,
    });
    const second = await prepareBlobEncryption({
      ...fixedInput(bytes),
      nonceSeed,
    });

    expect(second.sha256).toBe(first.sha256);
    expect(await materialize(second)).toEqual(await materialize(first));
  });

  test("derives a different base IV when bytes change under one nonce seed", async () => {
    const nonceSeed = new Uint8Array(12).fill(8);
    const first = await prepareBlobEncryption({
      ...fixedInput(new TextEncoder().encode("first same-size payload")),
      nonceSeed,
    });
    const second = await prepareBlobEncryption({
      ...fixedInput(new TextEncoder().encode("other same-size payload")),
      nonceSeed,
    });
    const firstRecord = parseBlobEncryptedBytes(await materialize(first));
    const secondRecord = parseBlobEncryptedBytes(await materialize(second));

    expect(firstRecord.byteLength).toBe(secondRecord.byteLength);
    expect(firstRecord.iv).not.toEqual(secondRecord.iv);
  });

  test("uses a fresh base IV when none is provided", async () => {
    const bytes = new TextEncoder().encode("fresh IV payload");
    const first = await prepareBlobEncryption(fixedInput(bytes));
    const second = await prepareBlobEncryption(fixedInput(bytes));

    expect(second.sha256).not.toBe(first.sha256);
  });

  test("handles empty, exact-boundary, and multi-chunk plaintext", async () => {
    const chunkSize = DEFAULT_BLOB_CHUNK_SIZE_BYTES;
    for (const plaintextByteLength of [
      0,
      1,
      chunkSize - 1,
      chunkSize,
      chunkSize + 1,
      chunkSize * 2,
    ]) {
      const bytes = Uint8Array.from(
        { length: plaintextByteLength },
        (_, index) => index,
      );
      const plan = await prepareBlobEncryption({
        ...fixedInput(bytes),
        nonceSeed: new Uint8Array(12).fill(9),
      });
      const encrypted = await materialize(plan);
      const parsed = parseBlobEncryptedBytes(encrypted);
      const expectedPartCount = Math.max(
        1,
        Math.ceil(plaintextByteLength / chunkSize),
      );

      expect(plan.partCount).toBe(expectedPartCount);
      expect(parsed.chunkCount).toBe(expectedPartCount);
      expect(parsed.byteLength).toBe(plaintextByteLength);
      expect(parsed.encryptedByteLength).toBe(plan.byteLength);
      expect(parsed.chunks.map((chunk) => chunk.plaintextByteLength)).toEqual(
        Array.from({ length: expectedPartCount }, (_, index) =>
          index < expectedPartCount - 1
            ? chunkSize
            : plaintextByteLength - chunkSize * (expectedPartCount - 1),
        ),
      );
      expect(await sha256Hex(encrypted)).toBe(plan.sha256);
    }
  });

  test("rejects a changed plaintext chunk before reusing its nonce", async () => {
    const bytes = new Uint8Array(DEFAULT_BLOB_CHUNK_SIZE_BYTES + 2).fill(3);
    const plan = await prepareBlobEncryption({
      ...fixedInput(bytes),
      nonceSeed: new Uint8Array(12).fill(4),
    });
    bytes[DEFAULT_BLOB_CHUNK_SIZE_BYTES + 1] = 8;

    await expect(plan.encryptPart(0)).resolves.toHaveLength(
      plan.getPartByteLength(0),
    );
    await expect(plan.encryptPart(1)).rejects.toThrow(
      "Blob plaintext chunk 1 changed after source inspection",
    );
  });

  test("rejects oversized chunks before reading a large source", async () => {
    let reads = 0;
    const source = {
      byteLength: 1024 * 1024 * 1024,
      async read(_offset: number, byteLength: number) {
        reads += 1;
        return new Uint8Array(byteLength);
      },
    };

    await expect(
      prepareBlobEncryption({
        ...fixedInput(new Uint8Array()),
        chunkSize: DEFAULT_BLOB_CHUNK_SIZE_BYTES + 1,
        source,
      }),
    ).rejects.toThrow("Blob chunk size must be exactly 5 MiB");
    expect(reads).toBe(0);
  });
});

describe("deriveBlobBaseIv", () => {
  const nonceSeed = new Uint8Array(12).fill(2);
  const plaintextSha256 = "ab".repeat(32);

  test("derives a different base IV for each chunk layout of one seed", async () => {
    const first = await deriveBlobBaseIv({
      chunkSize: DEFAULT_BLOB_CHUNK_SIZE_BYTES,
      nonceSeed,
      plaintextSha256,
    });
    const second = await deriveBlobBaseIv({
      chunkSize: DEFAULT_BLOB_CHUNK_SIZE_BYTES * 2,
      nonceSeed,
      plaintextSha256,
    });
    const repeated = await deriveBlobBaseIv({
      chunkSize: DEFAULT_BLOB_CHUNK_SIZE_BYTES,
      nonceSeed,
      plaintextSha256,
    });

    expect(second).not.toEqual(first);
    expect(repeated).toEqual(first);
  });

  test("rejects an invalid chunk size", async () => {
    for (const chunkSize of [0, -1, 1.5, Number.NaN]) {
      await expect(
        deriveBlobBaseIv({ chunkSize, nonceSeed, plaintextSha256 }),
      ).rejects.toThrow("Blob chunk size is invalid");
    }
  });
});

describe("parseBlobEncryptedBytes", () => {
  async function validEnvelope() {
    const plan = await prepareBlobEncryption({
      ...fixedInput(new Uint8Array(DEFAULT_BLOB_CHUNK_SIZE_BYTES + 1).fill(5)),
      nonceSeed: new Uint8Array(12).fill(6),
    });
    return materialize(plan);
  }

  test("rejects the old JSON envelope and invalid magic", async () => {
    expect(() =>
      parseBlobEncryptedBytes(
        new TextEncoder().encode('{"version":1}'.padEnd(40)),
      ),
    ).toThrow("magic is invalid");
    const encrypted = await validEnvelope();
    encrypted[0] = (encrypted[0] ?? 0) ^ 1;
    expect(() => parseBlobEncryptedBytes(encrypted)).toThrow(
      "magic is invalid",
    );
  });

  test("rejects invalid header fields", async () => {
    for (const [from, to, message] of [
      ['"version":2', '"version":1', "version 1 is invalid"],
      ['"chunkCount":2', '"chunkCount":1', "chunk count is invalid"],
      [
        '"encryptionSuite":"aes-256-gcm-hkdf-sha256-record-key"',
        '"encryptionSuite":"xes-256-gcm-hkdf-sha256-record-key"',
        "suite is invalid",
      ],
    ] as const) {
      const encrypted = await validEnvelope();
      const mutated = replaceAscii(encrypted, from, to);
      expect(() => parseBlobEncryptedBytes(mutated)).toThrow(message);
    }
  });

  test("rejects truncation, trailing bytes, and invalid header length", async () => {
    const encrypted = await validEnvelope();
    expect(() => parseBlobEncryptedBytes(encrypted.slice(0, -1))).toThrow(
      "length is invalid",
    );
    const appended = new Uint8Array(encrypted.byteLength + 1);
    appended.set(encrypted);
    expect(() => parseBlobEncryptedBytes(appended)).toThrow(
      "length is invalid",
    );

    const invalidHeaderLength = encrypted.slice();
    invalidHeaderLength.fill(0, "symcrypt.blob.bytes.v2".length, 27);
    expect(() => parseBlobEncryptedBytes(invalidHeaderLength)).toThrow(
      "header length is invalid",
    );
  });
});
