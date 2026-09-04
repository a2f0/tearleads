import { expect, test } from "bun:test";
import {
  type ContainerAccessEventBody,
  generateSigningSeedAndKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import { fixtureHash } from "@tearleads/crypto/test-fixtures";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  checkpointChildAt,
  checkpointRootAt,
  createGrandchildScenario,
  createScenario,
  grantBy,
  successor,
  verifyPath,
} from "../../../test/helpers/ancestorCitationScenario";
import { createTestTrustedUserIdentity } from "../../../test/helpers/trustedUserIdentity";
import { advanceKeyingCheckpointsAtomically } from "../persistence/keyingCheckpointAdvancePersistence";

// A head newer than this device's checkpoint for its container must cite the
// ancestor heads the projection serves as current, unless its signer still
// holds the authority the event needs at them. Mallory, revoked at root2, can
// still sign a child event citing root1, where she was admin; a device
// holding the child refuses it once root2 is served as current, and a device
// that also checkpointed root2 refuses root1 as served current, so the two
// checks compose. Alice, admin at root2, gains nothing by citing root1, so
// her late event is accepted. A device with no checkpoint for the child is
// at first contact with it (containerAncestorCitationChain.test.ts), and a
// later child event by a member with current authority recovers a refused
// head.

test("a head by a member with no current authority that cites a stale ancestor head is refused", async () => {
  const scenario = await createScenario();
  const child2 = await grantBy({
    cited: [scenario.root1.manifestHash, scenario.child1.manifestHash],
    previous: scenario.child1,
    signer: scenario.mallory,
    subjectId: scenario.mallory.userId,
  });
  const { close, execSql } = await createTestExecSql("ancestor-currency");
  try {
    await checkpointChildAt(scenario, execSql, scenario.child1, [
      scenario.root1,
      scenario.child1,
    ]);
    await expect(
      verifyPath(scenario, execSql, {
        bundles: [scenario.root1, scenario.root2, scenario.child1, child2],
        path: [scenario.root2, child2],
      }),
    ).rejects.toMatchObject({
      code: "stale_citation",
      message: expect.stringContaining("served current head"),
    });
  } finally {
    close();
  }
});

test("a head by a member with current authority that cites a stale ancestor head is accepted", async () => {
  const scenario = await createScenario();
  // Committed while root1 was current and first seen after root2. Alice is
  // admin at root2 too, so accepting it grants nothing she could not grant.
  const child2 = await grantBy({
    cited: [scenario.root1.manifestHash, scenario.child1.manifestHash],
    previous: scenario.child1,
    signer: scenario.alice,
    subjectId: "bob",
  });
  const { close, execSql } = await createTestExecSql("ancestor-authorized");
  try {
    await checkpointChildAt(scenario, execSql, scenario.child1, [
      scenario.root1,
      scenario.child1,
    ]);
    const verified = await verifyPath(scenario, execSql, {
      bundles: [scenario.root1, scenario.root2, scenario.child1, child2],
      path: [scenario.root2, child2],
    });
    expect(verified.map((manifest) => manifest.manifestHash)).toEqual([
      scenario.root2.manifestHash,
      child2.manifestHash,
    ]);
  } finally {
    close();
  }
});

test("a device that checkpointed the newer ancestor head cannot be served the older one either", async () => {
  const scenario = await createScenario();
  const child2 = await grantBy({
    cited: [scenario.root1.manifestHash, scenario.child1.manifestHash],
    previous: scenario.child1,
    signer: scenario.mallory,
    subjectId: scenario.mallory.userId,
  });
  const { close, execSql } = await createTestExecSql("ancestor-composed");
  try {
    await checkpointChildAt(scenario, execSql, scenario.child1, [
      scenario.root1,
      scenario.child1,
    ]);
    await checkpointRootAt(scenario, execSql, scenario.root2);
    // Serving root1 as current would satisfy the citation, but root1 is
    // older than this device's checkpoint for the root.
    await expect(
      verifyPath(scenario, execSql, {
        bundles: [scenario.root1, scenario.root2, scenario.child1, child2],
        path: [scenario.root1, child2],
      }),
    ).rejects.toMatchObject({
      code: "rollback",
      message: expect.stringContaining("older than the local checkpoint"),
    });
  } finally {
    close();
  }
});

test("a served ancestor head older than the one a head cites is a rollback, not a stale citation", async () => {
  const scenario = await createScenario();
  // Committed against root2: the signed event proves root2 exists, so a
  // server presenting root1 as current is stale or forked, and the device
  // must not wait on it as it would on an older citation.
  const child2 = await grantBy({
    cited: [scenario.root2.manifestHash, scenario.child1.manifestHash],
    previous: scenario.child1,
    signer: scenario.alice,
    subjectId: "bob",
  });
  const { close, execSql } = await createTestExecSql("ancestor-reversed");
  try {
    await checkpointChildAt(scenario, execSql, scenario.child1, [
      scenario.root1,
      scenario.child1,
    ]);
    await expect(
      verifyPath(scenario, execSql, {
        bundles: [scenario.root1, scenario.root2, scenario.child1, child2],
        path: [scenario.root1, child2],
      }),
    ).rejects.toMatchObject({
      code: "rollback",
      message: expect.stringContaining("does not descend"),
    });
  } finally {
    close();
  }
});

test("a later child event by a member with current authority recovers a refused head", async () => {
  const scenario = await createScenario();
  const child2 = await grantBy({
    cited: [scenario.root1.manifestHash, scenario.child1.manifestHash],
    previous: scenario.child1,
    signer: scenario.mallory,
    subjectId: scenario.mallory.userId,
  });
  // Alice's device accepted child2 before root2 reached it, or at first
  // contact; her event cites the current heads and carries child2 as history.
  const child3 = await grantBy({
    cited: [scenario.root2.manifestHash, child2.manifestHash],
    previous: child2,
    signer: scenario.alice,
    subjectId: "carol",
  });
  const { close, execSql } = await createTestExecSql("ancestor-recovery");
  try {
    await checkpointChildAt(scenario, execSql, scenario.child1, [
      scenario.root1,
      scenario.child1,
    ]);
    const bundles = [
      scenario.root1,
      scenario.root2,
      scenario.child1,
      child2,
      child3,
    ];
    await expect(
      verifyPath(scenario, execSql, {
        bundles,
        path: [scenario.root2, child2],
      }),
    ).rejects.toMatchObject({ code: "stale_citation" });
    const verified = await verifyPath(scenario, execSql, {
      bundles,
      path: [scenario.root2, child3],
    });
    expect(verified.map((manifest) => manifest.manifestHash)).toEqual([
      scenario.root2.manifestHash,
      child3.manifestHash,
    ]);
  } finally {
    close();
  }
});

test("a signed path snapshot is not held to the served current ancestor heads", async () => {
  const scenario = await createScenario();
  const child2 = await grantBy({
    cited: [scenario.root1.manifestHash, scenario.child1.manifestHash],
    previous: scenario.child1,
    signer: scenario.mallory,
    subjectId: scenario.mallory.userId,
  });
  const { close, execSql } = await createTestExecSql("ancestor-snapshot");
  try {
    await checkpointChildAt(scenario, execSql, scenario.child1, [
      scenario.root1,
      scenario.child1,
    ]);
    // A purge's authorizing path is the snapshot the purge cited, verified
    // at the membership it referenced; no later event can re-cite it.
    const verified = await verifyPath(scenario, execSql, {
      authorizationMembership: "referenced",
      bundles: [scenario.root1, scenario.root2, scenario.child1, child2],
      path: [scenario.root2, child2],
    });
    expect(verified).toHaveLength(2);
  } finally {
    close();
  }
});

test("an intermediate path element newer than its checkpoint is held to the served heads above it", async () => {
  const scenario = await createGrandchildScenario();
  // Bob becomes admin at root3 and revokes Alice at root4; Alice's event on
  // the middle container cited root2, where she still was admin.
  const root3 = await grantBy({
    cited: [scenario.root2.manifestHash],
    previous: scenario.root2,
    signer: scenario.alice,
    subjectId: "bob",
  });
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
  const revokeBody: ContainerAccessEventBody = {
    eventType: "container.revoke",
    containerKeyEpochId: "root-key-3",
    keyringHash: await fixtureHash("ancestor-root-keyring-3"),
    predecessorBridgeHash: await fixtureHash("ancestor-root-bridge-3"),
    subjectId: scenario.alice.userId,
    subjectType: "user",
  };
  const root4 = await successor({
    body: revokeBody,
    cited: [root3.manifestHash],
    previous: root3,
    signer: bob,
    state: (previous) => ({
      containerKeyEpochId: "root-key-3",
      directGrants: previous.directGrants.filter(
        (grant) => grant.subjectId !== scenario.alice.userId,
      ),
    }),
  });
  const middle2 = await grantBy({
    cited: [scenario.root2.manifestHash, scenario.middle.manifestHash],
    previous: scenario.middle,
    signer: scenario.alice,
    subjectId: "carol",
  });
  const { close, execSql } = await createTestExecSql("ancestor-middle");
  try {
    const [, checkpointedMiddle] = await verifyPath(withBob, execSql, {
      bundles: [scenario.root1, scenario.root2, scenario.middle],
      path: [scenario.root2, scenario.middle],
    });
    if (!checkpointedMiddle) throw new Error("Expected the middle to verify");
    await advanceKeyingCheckpointsAtomically({
      access: [{ head: checkpointedMiddle, predecessors: [] }],
      execSql,
      policies: [],
    });
    await expect(
      verifyPath(withBob, execSql, {
        bundles: [
          scenario.root1,
          scenario.root2,
          root3,
          root4,
          scenario.middle,
          middle2,
          scenario.leaf,
        ],
        path: [root4, middle2, scenario.leaf],
      }),
    ).rejects.toMatchObject({
      code: "stale_citation",
      message: expect.stringContaining("path[1]"),
    });
  } finally {
    close();
  }
});
