import { expect, test } from "bun:test";
import { generateSigningSeedAndKeyPair } from "../signing/generateKeyPair";
import type { IdentityStateHead, TransparencyLeaf } from "./index";
import {
  accessManifestTransparencyLeaf,
  computeTransparencyLeafHash,
  createTransparencyConsistencyProof,
  createTransparencyInclusionProof,
  identityStateTransparencyLeaf,
  verifyTransparencyProof,
} from "./index";
import {
  createVerifiedAccessManifestCheckpointFixture,
  expectVerificationError,
  fixtureHash,
  signTransparencyTreeHeadFixture,
} from "./testFixtures";

test("verifyTransparencyProof verifies inclusion against a signed tree head", async () => {
  const accessManifest = await createVerifiedAccessManifestCheckpointFixture({
    epoch: 1,
    previousManifestHash: null,
  });
  const identityHead: IdentityStateHead = {
    identityId: "user-1",
    version: 1,
    stateHash: await fixtureHash("transparency-identity-state"),
    previousStateHash: null,
  };
  const leaves: TransparencyLeaf[] = [
    identityStateTransparencyLeaf(identityHead),
    {
      version: 1,
      leafKind: "principal_policy_head",
      principalType: "group",
      principalId: "group-1",
      policyVersion: 3,
      keyEpoch: 2,
      stateHash: await fixtureHash("transparency-principal-state"),
      keyFingerprint: await fixtureHash("transparency-principal-key"),
    },
    accessManifestTransparencyLeaf(accessManifest),
  ];
  const leafHashes = await Promise.all(leaves.map(computeTransparencyLeafHash));
  const { treeHead, signingPublicKey } = await signTransparencyTreeHeadFixture({
    leafHashes,
  });
  const inclusionProof = await createTransparencyInclusionProof(leafHashes, 1);

  const verified = await verifyTransparencyProof({
    leaf: leaves[1] as TransparencyLeaf,
    inclusionProof,
    treeHead,
    logPublicKey: signingPublicKey,
  });
  expect(verified.ok).toBe(true);
  if (verified.ok) {
    expect(verified.value.treeHead.checkpoint.rootHash).toBe(treeHead.rootHash);
  }

  const tampered = await verifyTransparencyProof({
    leaf: {
      ...(leaves[1] as TransparencyLeaf),
      stateHash: await fixtureHash("transparency-principal-state-tampered"),
    } as TransparencyLeaf,
    inclusionProof,
    treeHead,
    logPublicKey: signingPublicKey,
  });
  expectVerificationError(tampered, "hash_mismatch");
});

test("verifyTransparencyProof verifies consistency from a pinned tree head", async () => {
  const leaves: TransparencyLeaf[] = [
    identityStateTransparencyLeaf({
      identityId: "user-1",
      version: 1,
      stateHash: await fixtureHash("consistency-leaf-1"),
      previousStateHash: null,
    }),
    identityStateTransparencyLeaf({
      identityId: "user-2",
      version: 1,
      stateHash: await fixtureHash("consistency-leaf-2"),
      previousStateHash: null,
    }),
    identityStateTransparencyLeaf({
      identityId: "user-3",
      version: 1,
      stateHash: await fixtureHash("consistency-leaf-3"),
      previousStateHash: null,
    }),
    identityStateTransparencyLeaf({
      identityId: "user-4",
      version: 1,
      stateHash: await fixtureHash("consistency-leaf-4"),
      previousStateHash: null,
    }),
  ];
  const leafHashes = await Promise.all(leaves.map(computeTransparencyLeafHash));
  const signing = generateSigningSeedAndKeyPair();
  const oldTree = await signTransparencyTreeHeadFixture({
    leafHashes: leafHashes.slice(0, 2),
    signing,
  });
  const newTree = await signTransparencyTreeHeadFixture({
    leafHashes,
    signing,
  });
  const inclusionProof = await createTransparencyInclusionProof(leafHashes, 3);
  const consistencyProof = await createTransparencyConsistencyProof(
    leafHashes,
    2,
  );

  const verified = await verifyTransparencyProof({
    leaf: leaves[3] as TransparencyLeaf,
    inclusionProof,
    treeHead: newTree.treeHead,
    previousTreeHead: oldTree.treeHead,
    consistencyProof,
    logPublicKey: signing.signingPublicKey,
  });
  expect(verified.ok).toBe(true);

  const alternateLeaves = [
    {
      ...(leaves[0] as TransparencyLeaf),
      stateHash: await fixtureHash("consistency-leaf-1-alternate"),
    } as TransparencyLeaf,
    ...leaves.slice(1),
  ];
  const alternateLeafHashes = await Promise.all(
    alternateLeaves.map(computeTransparencyLeafHash),
  );
  const alternateTree = await signTransparencyTreeHeadFixture({
    leafHashes: alternateLeafHashes,
    signing,
  });
  const alternateInclusionProof = await createTransparencyInclusionProof(
    alternateLeafHashes,
    3,
  );
  const alternateConsistencyProof = await createTransparencyConsistencyProof(
    alternateLeafHashes,
    2,
  );

  const firstContactSplitView = await verifyTransparencyProof({
    leaf: alternateLeaves[3] as TransparencyLeaf,
    inclusionProof: alternateInclusionProof,
    treeHead: alternateTree.treeHead,
    logPublicKey: signing.signingPublicKey,
  });
  expect(firstContactSplitView.ok).toBe(true);

  const pinnedCheckpointSplitView = await verifyTransparencyProof({
    leaf: alternateLeaves[3] as TransparencyLeaf,
    inclusionProof: alternateInclusionProof,
    treeHead: alternateTree.treeHead,
    previousTreeHead: oldTree.treeHead,
    consistencyProof: alternateConsistencyProof,
    logPublicKey: signing.signingPublicKey,
  });
  expectVerificationError(pinnedCheckpointSplitView, "hash_mismatch");
});

test("verifyTransparencyProof rejects non-empty consistency proofs from an empty tree", async () => {
  const leaf = identityStateTransparencyLeaf({
    identityId: "user-1",
    version: 1,
    stateHash: await fixtureHash("empty-consistency-leaf"),
    previousStateHash: null,
  });
  const leafHashes = [await computeTransparencyLeafHash(leaf)];
  const signing = generateSigningSeedAndKeyPair();
  const emptyTree = await signTransparencyTreeHeadFixture({
    leafHashes: [],
    signing,
  });
  const newTree = await signTransparencyTreeHeadFixture({
    leafHashes,
    signing,
  });

  const result = await verifyTransparencyProof({
    leaf,
    inclusionProof: await createTransparencyInclusionProof(leafHashes, 0),
    treeHead: newTree.treeHead,
    previousTreeHead: emptyTree.treeHead,
    consistencyProof: {
      version: 1,
      previousTreeSize: 0,
      treeSize: 1,
      nodeHashes: [await fixtureHash("unexpected-empty-consistency-node")],
    },
    logPublicKey: signing.signingPublicKey,
  });

  expectVerificationError(result, "invalid_shape");
});
