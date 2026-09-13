import { expect, test } from "bun:test";
import { generateSigningSeedAndKeyPair } from "../signing/generateKeyPair";
import { computeWriteHeaderHash, verifyWriteHeader } from "./index";
import {
  createWriteHeaderFixture,
  expectVerificationError,
  fixtureHash,
} from "./testFixtures";
import type { WriteHeader } from "./types";

test("write header signatures and hashes bind canonical complete path citations", async () => {
  const signing = generateSigningSeedAndKeyPair();
  const hashes = [
    await fixtureHash("parent"),
    await fixtureHash("leaf"),
  ].sort();
  const header = await createWriteHeaderFixture({
    signing,
    objectId: "document",
    organizationId: "organization",
    writerUserId: "writer",
    accessManifestHash: await fixtureHash("document"),
    targetHash: await fixtureHash("targets"),
    dependencyManifestHashes: hashes,
  });
  const changed = {
    ...header,
    dependencyManifestHashes: [await fixtureHash("other")],
  };
  expect(await computeWriteHeaderHash(changed)).not.toBe(
    await computeWriteHeaderHash(header),
  );
  expectVerificationError(
    await verifyWriteHeader({
      header: changed,
      writerPublicKey: signing.signingPublicKey,
    }),
    "signature_mismatch",
  );
  for (const dependencyManifestHashes of [
    undefined,
    [...hashes].reverse(),
    [hashes[0], hashes[0]],
  ]) {
    expectVerificationError(
      await verifyWriteHeader({
        header: {
          ...header,
          dependencyManifestHashes,
        } as unknown as WriteHeader,
        writerPublicKey: signing.signingPublicKey,
      }),
      "invalid_shape",
    );
  }
  expectVerificationError(
    await verifyWriteHeader({
      header: { ...header, dependencyManifestHashes: ["not-a-hash"] },
      writerPublicKey: signing.signingPublicKey,
    }),
    "hash_mismatch",
  );
});
