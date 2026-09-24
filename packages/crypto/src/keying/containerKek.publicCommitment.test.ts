import { expect, test } from "bun:test";
import { computeContainerKekMaterialId } from "./containerKekMaterial";
import { deriveContainerKekWrappingPublicKey } from "./containerKekWrapping";
import {
  createContainerManifestFixture,
  createVerifiedContainerKekStateFixture,
} from "./testFixtures";

test("public KEK verification binds the signed wrapping key without possessing the secret", async () => {
  const containerId = "public-commitment-root";
  const keyMaterial = new Uint8Array(32).fill(42);
  const containerKeyEpochId = await computeContainerKekMaterialId({
    containerId,
    keyEpoch: 1,
    keyMaterial,
  });
  const publicKey = await deriveContainerKekWrappingPublicKey({
    containerId,
    keyMaterial,
  });
  const swappedKey = await deriveContainerKekWrappingPublicKey({
    containerId,
    keyMaterial: new Uint8Array(32).fill(43),
  });
  const manifestFor = (containerKeyPublicKey: string) =>
    createContainerManifestFixture({
      containerId,
      containerKeyEpochId,
      containerKeyPublicKey,
      directGrants: [
        { subjectType: "user", subjectId: "owner", accessLevel: "admin" },
      ],
    });
  // The KEK-state verifier receives only signed public evidence and wrap records.
  await expect(
    createVerifiedContainerKekStateFixture({
      manifest: await manifestFor(publicKey),
      recipientUserId: "owner",
    }),
  ).resolves.toMatchObject({ containerKeyEpochId });
  await expect(
    createVerifiedContainerKekStateFixture({
      manifest: await manifestFor(swappedKey),
      recipientUserId: "owner",
    }),
  ).rejects.toMatchObject({
    code: "hash_mismatch",
    message: "container KEK public key does not match its epoch commitment",
  });
});
