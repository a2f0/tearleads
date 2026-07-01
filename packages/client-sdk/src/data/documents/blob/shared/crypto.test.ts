import { expect, test } from "bun:test";
import { createAesGcmIv } from "@tearleads/crypto";
import type { BlobContentKeyBundleRequest } from "@tearleads/validators/request";
import type { BlobBytes } from "../../../blobContracts";
import { encryptBlobBytes } from "./crypto";

const contentKeyBundle: BlobContentKeyBundleRequest = {
  contentKeyEpoch: 1,
  targetHash: "target-hash",
  targets: [],
};

function fixedInput() {
  return {
    blobId: "11111111-1111-4111-8111-111111111111",
    bytes: new TextEncoder().encode("resumable attachment bytes") as BlobBytes,
    contentKey: new Uint8Array(32).fill(7),
    contentKeyBundle,
    organizationId: "org-1",
  };
}

test("encryptBlobBytes reproduces identical bytes for the same IV", async () => {
  const iv = createAesGcmIv();
  const first = await encryptBlobBytes({ ...fixedInput(), iv });
  const second = await encryptBlobBytes({ ...fixedInput(), iv });

  // Byte-identical output is what lets a resumed upload reuse a stage keyed by
  // sha256 instead of orphaning it.
  expect(second.encryptedBytes).toBe(first.encryptedBytes);
  expect(second.sha256).toBe(first.sha256);
});

test("encryptBlobBytes produces different bytes for different IVs", async () => {
  const first = await encryptBlobBytes({
    ...fixedInput(),
    iv: createAesGcmIv(),
  });
  const second = await encryptBlobBytes({
    ...fixedInput(),
    iv: createAesGcmIv(),
  });

  expect(second.sha256).not.toBe(first.sha256);
});

test("encryptBlobBytes defaults to a fresh IV when none is provided", async () => {
  const first = await encryptBlobBytes(fixedInput());
  const second = await encryptBlobBytes(fixedInput());

  expect(second.sha256).not.toBe(first.sha256);
});
