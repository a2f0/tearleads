import { expect, test } from "bun:test";
import {
  generateSigningSeedAndKeyPair,
  toFingerprint,
  type VerifiedContainerAccessManifest,
} from "@tearleads/crypto";
import { createContainerManifestFixture } from "@tearleads/crypto/test-fixtures";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  checkpointChildAt,
  checkpointRootAt,
  createGrandchildScenario,
  createScenario,
  grantBy,
  ORGANIZATION_ID,
  type Signer,
  successor,
  verifyPath,
} from "../../../test/helpers/ancestorCitationScenario";
import { createTestTrustedUserIdentity } from "../../../test/helpers/trustedUserIdentity";
import { advanceKeyingCheckpointsAtomically } from "../persistence/keyingCheckpointAdvancePersistence";

// Moves. The projection serves a moved container's destination path, and a
// move's admin authority comes from the source ancestors, so their cited
// heads are held to this device's own checkpoints instead.

function moveBy(input: {
  readonly cited: readonly string[];
  readonly destination: VerifiedContainerAccessManifest;
  readonly keyEpoch: string;
  readonly previous: VerifiedContainerAccessManifest;
  readonly signer: Signer;
}) {
  return successor({
    body: {
      eventType: "container.move",
      parentContainerId: input.destination.state.containerId,
      parentManifestHash: input.destination.manifestHash,
      containerKeyEpochId: input.keyEpoch,
      keyringHash: "a".repeat(64),
      predecessorBridgeHash: "b".repeat(64),
    },
    cited: input.cited,
    previous: input.previous,
    signer: input.signer,
    state: () => ({
      containerKeyEpochId: input.keyEpoch,
      parentContainerId: input.destination.state.containerId,
      parentManifestHash: input.destination.manifestHash,
    }),
  });
}

function ownRoot(containerId: string, owner: Signer) {
  return createContainerManifestFixture({
    containerId,
    containerKeyEpochId: `${containerId}-key-1`,
    directGrants: [
      { accessLevel: "admin", subjectId: owner.userId, subjectType: "user" },
    ],
    organizationId: ORGANIZATION_ID,
    signer: owner.keyPair,
    signerUserId: owner.userId,
  });
}

test("a move citing a source ancestor head older than the device's checkpoint for it is refused", async () => {
  const scenario = await createScenario();
  // Mallory, revoked at root2, moves the child out of the root into her own
  // root, citing root1 where she still was admin.
  const malloryRoot = await ownRoot("currency-mallory-root", scenario.mallory);
  const stolen = await moveBy({
    cited: [
      scenario.root1.manifestHash,
      scenario.child1.manifestHash,
      malloryRoot.manifestHash,
    ],
    destination: malloryRoot,
    keyEpoch: "child-key-2",
    previous: scenario.child1,
    signer: scenario.mallory,
  });
  const { close, execSql } = await createTestExecSql("ancestor-move-source");
  try {
    await checkpointChildAt(scenario, execSql, scenario.child1, [
      scenario.root1,
      scenario.child1,
    ]);
    await checkpointRootAt(scenario, execSql, scenario.root2);
    await expect(
      verifyPath(scenario, execSql, {
        bundles: [
          scenario.root1,
          scenario.root2,
          scenario.child1,
          malloryRoot,
          stolen,
        ],
        path: [malloryRoot, stolen],
      }),
    ).rejects.toMatchObject({
      code: "stale_citation",
      message: expect.stringContaining("source ancestor"),
    });
  } finally {
    close();
  }
});

test("a move whose source citations are not older than the device's checkpoints is accepted", async () => {
  const scenario = await createScenario();
  const malloryRoot = await ownRoot("currency-mallory-root", scenario.mallory);
  const moved = await moveBy({
    cited: [
      scenario.root1.manifestHash,
      scenario.child1.manifestHash,
      malloryRoot.manifestHash,
    ],
    destination: malloryRoot,
    keyEpoch: "child-key-2",
    previous: scenario.child1,
    signer: scenario.mallory,
  });
  const { close, execSql } = await createTestExecSql("ancestor-move-current");
  try {
    // This device last saw the root at root1, where Mallory was admin.
    await checkpointChildAt(scenario, execSql, scenario.child1, [
      scenario.root1,
      scenario.child1,
    ]);
    await checkpointRootAt(scenario, execSql, scenario.root1);
    const verified = await verifyPath(scenario, execSql, {
      bundles: [scenario.root1, scenario.child1, malloryRoot, moved],
      path: [malloryRoot, moved],
    });
    expect(verified).toHaveLength(2);
  } finally {
    close();
  }
});

test("a head under an ancestor that has since moved is re-checked at the served path", async () => {
  const scenario = await createGrandchildScenario();
  const bob = { keyPair: generateSigningSeedAndKeyPair(), userId: "bob" };
  const bobIdentity = await createTestTrustedUserIdentity({
    signingKeyFingerprint: await toFingerprint(bob.keyPair.signingPublicKey),
    signingPublicKey: bob.keyPair.signingPublicKey,
    userId: bob.userId,
  });
  const withBob = {
    ...scenario,
    resolveUserKey: async (userId: string) =>
      userId === bob.userId ? bobIdentity : scenario.resolveUserKey(userId),
  };
  const root3 = await grantBy({
    cited: [scenario.root2.manifestHash],
    previous: scenario.root2,
    signer: scenario.alice,
    subjectId: bob.userId,
  });
  // Bob and Alice each sign a leaf event while the middle sits under root3.
  const leafByBob = await grantBy({
    cited: [
      root3.manifestHash,
      scenario.middle.manifestHash,
      scenario.leaf.manifestHash,
    ],
    previous: scenario.leaf,
    signer: bob,
    subjectId: "carol",
  });
  const leafByAlice = await grantBy({
    cited: [
      root3.manifestHash,
      scenario.middle.manifestHash,
      scenario.leaf.manifestHash,
    ],
    previous: scenario.leaf,
    signer: scenario.alice,
    subjectId: "dave",
  });
  // Alice then moves the middle into a root only she administers, so the
  // leaf's served path names an ancestor neither leaf event cites.
  const otherRoot = await ownRoot("currency-other-root", scenario.alice);
  const middle2 = await moveBy({
    cited: [
      root3.manifestHash,
      scenario.middle.manifestHash,
      otherRoot.manifestHash,
    ],
    destination: otherRoot,
    keyEpoch: "middle-key-2",
    previous: scenario.middle,
    signer: scenario.alice,
  });
  const { close, execSql } = await createTestExecSql("ancestor-moved-above");
  try {
    const [, , checkpointedLeaf] = await verifyPath(withBob, execSql, {
      bundles: [scenario.root1, scenario.root2, scenario.middle, scenario.leaf],
      path: [scenario.root2, scenario.middle, scenario.leaf],
    });
    if (!checkpointedLeaf) throw new Error("Expected the leaf to verify");
    await advanceKeyingCheckpointsAtomically({
      access: [{ head: checkpointedLeaf, predecessors: [] }],
      execSql,
      policies: [],
    });
    const bundles = [
      scenario.root1,
      scenario.root2,
      root3,
      scenario.middle,
      middle2,
      otherRoot,
      scenario.leaf,
      leafByAlice,
      leafByBob,
    ];
    const verified = await verifyPath(withBob, execSql, {
      bundles,
      path: [otherRoot, middle2, leafByAlice],
    });
    expect(verified).toHaveLength(3);
    await expect(
      verifyPath(withBob, execSql, {
        bundles,
        path: [otherRoot, middle2, leafByBob],
      }),
    ).rejects.toMatchObject({
      code: "stale_citation",
      message: expect.stringContaining("path[2]"),
    });
  } finally {
    close();
  }
});
