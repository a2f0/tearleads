import { expect, test } from "bun:test";
import {
  generateSigningSeedAndKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  checkpointChildAt,
  createScenario,
  grantBy,
  successor,
  verifyPath,
} from "../../../test/helpers/ancestorCitationScenario";
import { createTestTrustedUserIdentity } from "../../../test/helpers/trustedUserIdentity";

// The served-path re-check: whose authority it reads, from which state, and
// at which level. A stale-citing head by a member still authorized at the
// served current path is accepted; the authority is read from the served
// ancestors and the container's state at this device's checkpoint, never
// from the unheld history between the checkpoint and the head.

test("an unheld intermediate self-grant lends the re-check no authority", async () => {
  const scenario = await createScenario();
  // Mallory, revoked at root2, first grants herself admin on the child under
  // root1, then signs a further event on top of it; the head is re-checked
  // above the child's state as this device last accepted it, not above the
  // grant she wrote herself.
  const selfGrant = await grantBy({
    cited: [scenario.root1.manifestHash, scenario.child1.manifestHash],
    previous: scenario.child1,
    signer: scenario.mallory,
    subjectId: scenario.mallory.userId,
  });
  const child3 = await grantBy({
    cited: [scenario.root1.manifestHash, selfGrant.manifestHash],
    previous: selfGrant,
    signer: scenario.mallory,
    subjectId: "eve",
  });
  const { close, execSql } = await createTestExecSql("ancestor-self-grant");
  try {
    await checkpointChildAt(scenario, execSql, scenario.child1, [
      scenario.root1,
      scenario.child1,
    ]);
    await expect(
      verifyPath(scenario, execSql, {
        bundles: [
          scenario.root1,
          scenario.root2,
          scenario.child1,
          selfGrant,
          child3,
        ],
        path: [scenario.root2, child3],
      }),
    ).rejects.toMatchObject({ code: "stale_citation" });
  } finally {
    close();
  }
});

test("the re-check demands the access the event needs: write for a rekey, admin for a grant", async () => {
  const scenario = await createScenario();
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
  // Bob is admin at root3 and demoted to write at root4, which the device
  // is served; both of his child events cite root3.
  const root3 = await grantBy({
    cited: [scenario.root2.manifestHash],
    previous: scenario.root2,
    signer: scenario.alice,
    subjectId: bob.userId,
  });
  const writeGrant = {
    accessLevel: "write" as const,
    subjectId: bob.userId,
    subjectType: "user" as const,
  };
  const root4 = await successor({
    body: {
      eventType: "container.grant",
      containerKeyEpochId: root3.state.containerKeyEpochId,
      grant: writeGrant,
      referencedPrincipalHead: null,
    },
    cited: [root3.manifestHash],
    previous: root3,
    signer: scenario.alice,
    state: (previous) => ({
      directGrants: previous.directGrants.map((grant) =>
        grant.subjectId === bob.userId ? writeGrant : grant,
      ),
    }),
  });
  const rekeyByBob = await successor({
    body: {
      eventType: "container.rekey",
      containerKeyEpochId: "child-key-2",
      keyringHash: "a".repeat(64),
      predecessorBridgeHash: "b".repeat(64),
    },
    cited: [root3.manifestHash, scenario.child1.manifestHash],
    previous: scenario.child1,
    signer: bob,
    state: () => ({ containerKeyEpochId: "child-key-2" }),
  });
  const grantByBob = await grantBy({
    cited: [root3.manifestHash, scenario.child1.manifestHash],
    previous: scenario.child1,
    signer: bob,
    subjectId: "dave",
  });
  const { close, execSql } = await createTestExecSql("ancestor-access-level");
  try {
    await checkpointChildAt(withBob, execSql, scenario.child1, [
      scenario.root1,
      scenario.child1,
    ]);
    const bundles = [
      scenario.root1,
      scenario.root2,
      root3,
      root4,
      scenario.child1,
      rekeyByBob,
      grantByBob,
    ];
    const verified = await verifyPath(withBob, execSql, {
      bundles,
      path: [root4, rekeyByBob],
    });
    expect(verified).toHaveLength(2);
    await expect(
      verifyPath(withBob, execSql, { bundles, path: [root4, grantByBob] }),
    ).rejects.toMatchObject({ code: "stale_citation" });
  } finally {
    close();
  }
});

test("a member granted admin in unheld history is refused until a current admin acts", async () => {
  const scenario = await createScenario();
  // Alice, still admin at root2, grants Carol admin on the child while root1
  // is current; Carol's own event then arrives at a device that last saw
  // the child before the grant. Carol holds nothing at the checkpointed
  // state, so her event is refused as the availability cost of the rule,
  // until Alice or another current admin commits a later child event.
  const carol = { keyPair: generateSigningSeedAndKeyPair(), userId: "carol" };
  const carolIdentity = await createTestTrustedUserIdentity({
    signingKeyFingerprint: await toFingerprint(carol.keyPair.signingPublicKey),
    signingPublicKey: carol.keyPair.signingPublicKey,
    userId: carol.userId,
  });
  const withCarol = {
    ...scenario,
    resolveUserKey: async (userId: string) =>
      userId === carol.userId ? carolIdentity : scenario.resolveUserKey(userId),
  };
  const carolGrant = await grantBy({
    cited: [scenario.root1.manifestHash, scenario.child1.manifestHash],
    previous: scenario.child1,
    signer: scenario.alice,
    subjectId: carol.userId,
  });
  const carolEvent = await grantBy({
    cited: [scenario.root1.manifestHash, carolGrant.manifestHash],
    previous: carolGrant,
    signer: carol,
    subjectId: "dave",
  });
  const { close, execSql } = await createTestExecSql("ancestor-benign-grant");
  try {
    await checkpointChildAt(withCarol, execSql, scenario.child1, [
      scenario.root1,
      scenario.child1,
    ]);
    await expect(
      verifyPath(withCarol, execSql, {
        bundles: [
          scenario.root1,
          scenario.root2,
          scenario.child1,
          carolGrant,
          carolEvent,
        ],
        path: [scenario.root2, carolEvent],
      }),
    ).rejects.toMatchObject({ code: "stale_citation" });
  } finally {
    close();
  }
});
