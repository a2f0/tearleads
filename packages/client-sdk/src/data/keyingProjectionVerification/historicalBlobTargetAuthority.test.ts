import { expect, test } from "bun:test";
import {
  computeBlobAccessManifestHash,
  computeBlobContentKeyTargetHash,
  makeVerifiedBlobKekTargets,
  type VerifiedContainerAccessManifest,
  verifyWriteHeader,
} from "@tearleads/crypto";
import {
  createWriteHeaderFixture,
  fixtureHash,
} from "@tearleads/crypto/test-fixtures";
import {
  createScenario,
  grantBy,
} from "../../../test/helpers/ancestorCitationScenario";
import { addHistoricalContainerTargetPaths } from "./historicalContainerTargetPaths";

test("an incomplete historical blob path admits only a direct leaf writer, not an inherited writer", async () => {
  const { alice, mallory, root1, child1 } = await createScenario();
  const child = await grantBy({
    cited: [root1.manifestHash, child1.manifestHash],
    previous: child1,
    signer: alice,
    subjectId: mallory.userId,
  });
  const blobId = "historical-blob";
  const organizationId = child.state.organizationId;
  if (!child.state.containerKeyEpochId)
    throw new Error("Expected child key epoch");
  const targets = [
    {
      bindingId: "binding",
      documentId: "document",
      containerId: child.state.containerId,
      containerManifestHash: child.manifestHash,
      containerKeyEpochId: child.state.containerKeyEpochId,
      containerKeyEpoch: 1,
    },
  ];
  const manifest = {
    version: 1 as const,
    blobId,
    organizationId,
    activeBindingIds: ["binding"],
    documentManifestHashes: [await fixtureHash("document-manifest")],
    linkedContainerManifestHashes: [child.manifestHash],
    linkedContainerKeyEpochIds: [child.state.containerKeyEpochId],
    blobKeyTargetHash: await computeBlobContentKeyTargetHash(targets),
  };
  // This unit starts at the already-verified manifest/target boundary, just as
  // historical path reconstruction does. It tests write authorization, not
  // target derivation, binding verification, key unwrap, or ciphertext parsing.
  const blobKekTargets = makeVerifiedBlobKekTargets({
    ...manifest,
    targets,
    blobAccessManifestHash: await computeBlobAccessManifestHash(manifest),
  });
  const paths = new Map<string, readonly VerifiedContainerAccessManifest[]>();
  addHistoricalContainerTargetPaths({
    containerPathByManifestHash: paths,
    manifests: new Map([[child.manifestHash, child]]),
  });
  expect(paths.get(child.manifestHash)).toEqual([child]);
  // Blob decryption passes this exact collection to its write-header verifier.
  for (const [writer, accepted] of [
    [mallory, true],
    [alice, false],
  ] as const) {
    const header = await createWriteHeaderFixture({
      accessManifestHash: blobKekTargets.blobAccessManifestHash,
      objectId: blobId,
      objectKind: "blob",
      organizationId,
      signing: writer.keyPair,
      targetHash: blobKekTargets.blobKeyTargetHash,
      writerUserId: writer.userId,
    });
    const result = await verifyWriteHeader({
      blobAuthorization: {
        authorizingContainerPaths: [...paths.values()],
        blobKekTargets,
      },
      header,
      writerPublicKey: writer.keyPair.signingPublicKey,
    });
    expect(result.ok).toBe(accepted);
    if (!result.ok) expect(result.error.code).toBe("unauthorized");
  }
});
