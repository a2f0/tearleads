// A write header is stored and served with every update, so the fields its
// writer chooses the size of are bounded where every header is parsed: when
// it is signed and when it is verified.
import { expect, test } from "bun:test";
import {
  MAX_DOCUMENT_SYNC_AUTHORIZATION_PATH_REFS,
  MAX_WRITE_HEADER_WRITER_DEVICE_ID_LENGTH,
} from "@tearleads/validators/util";
import { generateSigningSeedAndKeyPair } from "../../signing/generateKeyPair";
import { fixtureHash } from "../core/canonical.testFixtures";
import { expectVerificationError } from "../core/verificationError.testFixtures";
import { signWriteHeader, verifyWriteHeader } from "../index";
import { createWriteHeaderFixture } from "./writeHeader.testFixtures";

const signing = generateSigningSeedAndKeyPair();

function citations(count: number): string[] {
  return Array.from({ length: count }, (_, index) =>
    index.toString(16).padStart(64, "0"),
  );
}

async function header(input: {
  readonly citations: number;
  readonly objectKind?: "blob" | "document";
}) {
  return createWriteHeaderFixture({
    accessManifestHash: await fixtureHash("bounded-manifest"),
    dependencyManifestHashes: citations(input.citations),
    objectId: "object-1",
    objectKind: input.objectKind ?? "document",
    organizationId: "organization-1",
    signing,
    targetHash: await fixtureHash("bounded-targets"),
    writerUserId: "user-1",
  });
}

const verify = (candidate: unknown) =>
  verifyWriteHeader({
    // The verifier reads an untrusted record.
    header: candidate as Parameters<typeof verifyWriteHeader>[0]["header"],
    writerPublicKey: signing.signingPublicKey,
  });

test("a document header cites at most what a document's authorization names", async () => {
  const most = await header({
    citations: MAX_DOCUMENT_SYNC_AUTHORIZATION_PATH_REFS,
  });
  expect((await verify(most)).ok).toBe(true);

  // One more is refused when signed, and when verified, before its hashes
  // or its signature are read.
  await expect(
    header({ citations: MAX_DOCUMENT_SYNC_AUTHORIZATION_PATH_REFS + 1 }),
  ).rejects.toThrow("may cite at most 6400 container manifests");
  expectVerificationError(
    await verify({
      ...most,
      dependencyManifestHashes: [
        ...most.dependencyManifestHashes,
        "f".repeat(64),
      ],
    }),
    "invalid_shape",
  );

  // A blob header's citations are bounded by its own request, not here.
  const blob = await header({
    citations: MAX_DOCUMENT_SYNC_AUTHORIZATION_PATH_REFS + 1,
    objectKind: "blob",
  });
  expect((await verify(blob)).ok).toBe(true);
});

test("a header names its device in a bounded string", async () => {
  const { signature: _, ...unsigned } = await header({ citations: 1 });
  const named = (writerDeviceId: string) =>
    signWriteHeader({ ...unsigned, writerDeviceId }, signing.signingPrivateKey);
  const longest = await named(
    "d".repeat(MAX_WRITE_HEADER_WRITER_DEVICE_ID_LENGTH),
  );
  expect((await verify(longest)).ok).toBe(true);
  await expect(
    named("d".repeat(MAX_WRITE_HEADER_WRITER_DEVICE_ID_LENGTH + 1)),
  ).rejects.toThrow("writerDeviceId may be at most 128 characters");
  expectVerificationError(
    await verify({ ...longest, writerDeviceId: `${longest.writerDeviceId}x` }),
    "invalid_shape",
  );
});

// The base64 decoder forgives whitespace. A signature that verifies only
// after it is stripped would let a verified header carry any amount of it.
test("a header's signature is canonical base64", async () => {
  const signed = await header({ citations: 1 });
  expect((await verify(signed)).ok).toBe(true);
  for (const signature of [
    `${signed.signature}\n`,
    ` ${signed.signature}`,
    `${signed.signature.slice(0, 8)} ${signed.signature.slice(8)}`,
    signed.signature.replace(/=+$/u, ""),
  ]) {
    if (signature === signed.signature) continue;
    expectVerificationError(
      await verify({ ...signed, signature }),
      "signature_mismatch",
    );
  }
});
