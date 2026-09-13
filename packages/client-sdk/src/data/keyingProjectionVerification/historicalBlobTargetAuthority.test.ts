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
import { resolveEventContainerPaths } from "./documentDependencyPaths";

test("historical blob writes require complete citations even for a direct leaf writer", async () => {
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
  paths.set(child.manifestHash, [child]);
  const dependencyManifestHashes = [
    root1.manifestHash,
    child.manifestHash,
  ].sort();
  expect(() =>
    resolveEventContainerPaths({
      containerPathByManifestHash: paths,
      dependencyManifestHashes,
    }),
  ).toThrow("unavailable container manifest");
  paths.set(root1.manifestHash, [root1]);
  const { dependencyContainerPaths } = resolveEventContainerPaths({
    containerPathByManifestHash: paths,
    dependencyManifestHashes,
  });
  for (const writer of [mallory, alice]) {
    const header = await createWriteHeaderFixture({
      accessManifestHash: blobKekTargets.blobAccessManifestHash,
      dependencyManifestHashes,
      objectId: blobId,
      objectKind: "blob",
      organizationId,
      signing: writer.keyPair,
      targetHash: blobKekTargets.blobKeyTargetHash,
      writerUserId: writer.userId,
    });
    const result = await verifyWriteHeader({
      authorizationMembership: "referenced",
      blobAuthorization: {
        authorizingContainerPaths: dependencyContainerPaths,
        blobKekTargets,
      },
      header,
      writerPublicKey: writer.keyPair.signingPublicKey,
    });
    expect(result.ok).toBe(true);
  }
});
