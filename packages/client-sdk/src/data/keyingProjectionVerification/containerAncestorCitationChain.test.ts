import { expect, test } from "bun:test";
import type {
  ContainerAccessEventBody,
  ContainerAccessManifestState,
  VerifiedContainerAccessManifest,
} from "@tearleads/crypto";
import { deriveContainerAccessManifest } from "@tearleads/crypto";
import {
  createContainerManifestFixture,
  createVerifiedContainerAccessEvent,
} from "@tearleads/crypto/test-fixtures";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  checkpointRootAt,
  createGrandchildScenario,
  createScenario,
  grantBy,
  ORGANIZATION_ID,
  ROOT_ID,
  type Signer,
  successor,
  verifyPath,
} from "../../../test/helpers/ancestorCitationScenario";

// Citations along a deeper chain, and the two paths a move cites.

test("a head must not cite an older grandparent head than a cited child was created under", async () => {
  const scenario = await createGrandchildScenario();
  // The middle container pins root2, so citing root1 above it is a rollback
  // whatever the leaf's own history says.
  const forged = await grantBy({
    cited: [
      scenario.root1.manifestHash,
      scenario.middle.manifestHash,
      scenario.leaf.manifestHash,
    ],
    previous: scenario.leaf,
    signer: scenario.mallory,
    subjectId: scenario.mallory.userId,
  });
  const { close, execSql } = await createTestExecSql("ancestor-grandparent");
  try {
    await expect(
      verifyPath(scenario, execSql, {
        bundles: [
          scenario.root1,
          scenario.root2,
          scenario.middle,
          scenario.leaf,
          forged,
        ],
        path: [scenario.root2, scenario.middle, forged],
      }),
    ).rejects.toMatchObject({
      code: "rollback",
      message: expect.stringContaining("does not descend"),
    });
  } finally {
    close();
  }
});

test("a move's source path is authorized at the source ancestors it cites", async () => {
  const scenario = await createScenario();
  // Mallory administers her own root but not the child's source root.
  const malloryRoot = await createContainerManifestFixture({
    containerId: "ancestor-mallory-root",
    containerKeyEpochId: "mallory-root-key-1",
    directGrants: [
      {
        accessLevel: "admin",
        subjectId: scenario.mallory.userId,
        subjectType: "user",
      },
    ],
    organizationId: ORGANIZATION_ID,
    signer: scenario.mallory.keyPair,
    signerUserId: scenario.mallory.userId,
  });
  const moveBy = (signer: Signer) =>
    successor({
      body: {
        eventType: "container.move",
        parentContainerId: malloryRoot.state.containerId,
        parentManifestHash: malloryRoot.manifestHash,
        containerKeyEpochId: "child-key-2",
        keyringHash: `${"a".repeat(64)}`,
        predecessorBridgeHash: `${"b".repeat(64)}`,
      },
      cited: [
        scenario.root2.manifestHash,
        scenario.child1.manifestHash,
        malloryRoot.manifestHash,
      ],
      previous: scenario.child1,
      signer,
      state: () => ({
        containerKeyEpochId: "child-key-2",
        parentContainerId: malloryRoot.state.containerId,
        parentManifestHash: malloryRoot.manifestHash,
      }),
    });
  const { close, execSql } = await createTestExecSql("ancestor-move-source");
  try {
    const bundlesFor = (moved: VerifiedContainerAccessManifest) => [
      scenario.root1,
      scenario.root2,
      scenario.child1,
      malloryRoot,
      moved,
    ];
    const stolen = await moveBy(scenario.mallory);
    await expect(
      verifyPath(scenario, execSql, {
        bundles: bundlesFor(stolen),
        path: [malloryRoot, stolen],
      }),
    ).rejects.toMatchObject({
      code: "unauthorized",
      message: expect.stringContaining("container.move source"),
    });
    // Alice administers the source root; she may only move it where she can
    // write, so grant her that on Mallory's root first.
    const sharedRoot = await grantBy({
      cited: [malloryRoot.manifestHash],
      previous: malloryRoot,
      signer: scenario.mallory,
      subjectId: scenario.alice.userId,
    });
    const legitimate = await successor({
      body: {
        eventType: "container.move",
        parentContainerId: sharedRoot.state.containerId,
        parentManifestHash: sharedRoot.manifestHash,
        containerKeyEpochId: "child-key-2",
        keyringHash: `${"a".repeat(64)}`,
        predecessorBridgeHash: `${"b".repeat(64)}`,
      },
      cited: [
        scenario.root2.manifestHash,
        scenario.child1.manifestHash,
        sharedRoot.manifestHash,
      ],
      previous: scenario.child1,
      signer: scenario.alice,
      state: () => ({
        containerKeyEpochId: "child-key-2",
        parentContainerId: sharedRoot.state.containerId,
        parentManifestHash: sharedRoot.manifestHash,
      }),
    });
    const verified = await verifyPath(scenario, execSql, {
      bundles: [...bundlesFor(legitimate), sharedRoot],
      path: [sharedRoot, legitimate],
    });
    expect(verified).toHaveLength(2);
  } finally {
    close();
  }
});

test("a move must not cite an older source ancestor head than its predecessor cited", async () => {
  const scenario = await createScenario();
  // The child's latest grant already cited root2.
  const child2 = await grantBy({
    cited: [scenario.root2.manifestHash, scenario.child1.manifestHash],
    previous: scenario.child1,
    signer: scenario.alice,
    subjectId: "bob",
  });
  const malloryRoot = await createContainerManifestFixture({
    containerId: "ancestor-mallory-root-2",
    containerKeyEpochId: "mallory-root-2-key-1",
    directGrants: [
      {
        accessLevel: "admin",
        subjectId: scenario.mallory.userId,
        subjectType: "user",
      },
    ],
    organizationId: ORGANIZATION_ID,
    signer: scenario.mallory.keyPair,
    signerUserId: scenario.mallory.userId,
  });
  // Revoked at root2, Mallory cites root1 for the source path, where she was
  // still an admin, to move the child into her own root.
  const stolen = await successor({
    body: {
      eventType: "container.move",
      parentContainerId: malloryRoot.state.containerId,
      parentManifestHash: malloryRoot.manifestHash,
      containerKeyEpochId: "child-key-3",
      keyringHash: `${"a".repeat(64)}`,
      predecessorBridgeHash: `${"b".repeat(64)}`,
    },
    cited: [
      scenario.root1.manifestHash,
      child2.manifestHash,
      malloryRoot.manifestHash,
    ],
    previous: child2,
    signer: scenario.mallory,
    state: () => ({
      containerKeyEpochId: "child-key-3",
      parentContainerId: malloryRoot.state.containerId,
      parentManifestHash: malloryRoot.manifestHash,
    }),
  });
  const { close, execSql } = await createTestExecSql("ancestor-move-regress");
  try {
    await expect(
      verifyPath(scenario, execSql, {
        bundles: [
          scenario.root1,
          scenario.root2,
          scenario.child1,
          child2,
          malloryRoot,
          stolen,
        ],
        path: [malloryRoot, stolen],
      }),
    ).rejects.toMatchObject({
      code: "rollback",
      message: expect.stringContaining("does not descend"),
    });
  } finally {
    close();
  }
});

// Pins the boundary the security docs state: until descendants can re-cite
// their ancestors (#2166), a device accepts a child head authorized under an
// older ancestor head even when it has checkpointed the newer one. Only a
// signed statement that already established the newer head rejects it.
test("a device that checkpointed a newer ancestor head still accepts a child head citing the older one", async () => {
  const scenario = await createScenario();
  const forged = await grantBy({
    cited: [scenario.root1.manifestHash, scenario.child1.manifestHash],
    previous: scenario.child1,
    signer: scenario.mallory,
    subjectId: scenario.mallory.userId,
  });
  const { close, execSql } = await createTestExecSql("ancestor-boundary");
  try {
    await checkpointRootAt(scenario, execSql, scenario.root2);
    const verified = await verifyPath(scenario, execSql, {
      bundles: [scenario.root1, scenario.root2, scenario.child1, forged],
      path: [scenario.root2, forged],
    });
    expect(verified).toHaveLength(2);
  } finally {
    close();
  }
});

test("a same-epoch fork of an ancestor cannot authorize a later child head", async () => {
  const scenario = await createScenario();
  // The child's latest grant established root2.
  const child2 = await grantBy({
    cited: [scenario.root2.manifestHash, scenario.child1.manifestHash],
    previous: scenario.child1,
    signer: scenario.alice,
    subjectId: "bob",
  });
  // Mallory forks the root at the same epoch from root1, where she was still
  // an admin, so the fork verifies as history and keeps her grant.
  const forkedRoot = await grantBy({
    cited: [scenario.root1.manifestHash],
    previous: scenario.root1,
    signer: scenario.mallory,
    subjectId: "carol",
  });
  expect(forkedRoot.state.epoch).toBe(scenario.root2.state.epoch);
  const forged = await grantBy({
    cited: [forkedRoot.manifestHash, child2.manifestHash],
    previous: child2,
    signer: scenario.mallory,
    subjectId: scenario.mallory.userId,
  });
  const { close, execSql } = await createTestExecSql("ancestor-fork");
  try {
    await expect(
      verifyPath(scenario, execSql, {
        bundles: [
          scenario.root1,
          scenario.root2,
          forkedRoot,
          scenario.child1,
          child2,
          forged,
        ],
        path: [scenario.root2, forged],
      }),
    ).rejects.toMatchObject({
      code: "rollback",
      message: expect.stringContaining("does not descend"),
    });
  } finally {
    close();
  }
});

test("served bundles that refer to each other under claimed hashes fail instead of recursing", async () => {
  const scenario = await createScenario();
  const claimedX = "1".repeat(64);
  const claimedY = "2".repeat(64);
  // Two root grants whose signed previous links point at each other's
  // claimed hashes; neither hash is real, so neither ever verifies.
  const forgeRootGrant = async (previousManifestHash: string) => {
    const grant = {
      accessLevel: "admin" as const,
      subjectId: "carol",
      subjectType: "user" as const,
    };
    const body: ContainerAccessEventBody = {
      eventType: "container.grant",
      containerKeyEpochId: scenario.root1.state.containerKeyEpochId,
      grant,
      referencedPrincipalHead: null,
    };
    const event = await createVerifiedContainerAccessEvent({
      body,
      dependencyManifestHashes: [previousManifestHash],
      objectId: ROOT_ID,
      organizationId: ORGANIZATION_ID,
      previousManifestHash,
      signer: scenario.alice.keyPair,
      signerUserId: scenario.alice.userId,
    });
    const state: ContainerAccessManifestState = {
      ...scenario.root1.state,
      directGrants: [...scenario.root1.state.directGrants, grant],
      epoch: 2,
      eventHash: event.eventHash,
      previousManifestHash,
    };
    const manifest = await deriveContainerAccessManifest(state);
    return { event, manifest, state } as VerifiedContainerAccessManifest;
  };
  const x = { ...(await forgeRootGrant(claimedY)), manifestHash: claimedX };
  const y = { ...(await forgeRootGrant(claimedX)), manifestHash: claimedY };
  // The child cites X as its root head.
  const child = await grantBy({
    cited: [claimedX, scenario.child1.manifestHash],
    previous: scenario.child1,
    signer: scenario.alice,
    subjectId: "bob",
  });
  const { close, execSql } = await createTestExecSql("ancestor-cycle");
  try {
    await expect(
      verifyPath(scenario, execSql, {
        bundles: [scenario.root1, scenario.child1, x, y, child],
        path: [scenario.root2, child],
      }),
    ).rejects.toMatchObject({
      code: "object_mismatch",
      message: expect.stringContaining("refers back"),
    });
  } finally {
    close();
  }
});
