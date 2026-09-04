import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  checkpointChildAt,
  createGrandchildScenario,
  createScenario,
  grantBy,
  verifyPath,
} from "../../../test/helpers/ancestorCitationScenario";
import { advanceKeyingCheckpointsAtomically } from "../persistence/keyingCheckpointAdvancePersistence";

// A head newer than this device's checkpoint for its container must cite the
// ancestor heads the projection serves as current, so a member revoked from
// an ancestor cannot, with a server that still presents the older ancestor
// head, commit a child event that a device already holding the child would
// take for a stale delivery. A device with no checkpoint is at first contact
// and takes the served history as it is (containerAncestorCitations.test.ts);
// a later child event that cites the current heads recovers a refused head.

test("a head newer than the local checkpoint must cite the served current ancestor heads", async () => {
  const scenario = await createScenario();
  // Mallory, revoked at root2, signs a child event citing root1, which a
  // colluding server presents as still current to a device that has not
  // seen root2.
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
      code: "rollback",
      message: expect.stringContaining("served current head"),
    });
  } finally {
    close();
  }
});

test("a later child event that cites the current heads recovers a refused head", async () => {
  const scenario = await createScenario();
  // Committed while root1 was current, then first seen after root2: refused
  // on its own, since the device cannot tell it from the forgery above.
  const child2 = await grantBy({
    cited: [scenario.root1.manifestHash, scenario.child1.manifestHash],
    previous: scenario.child1,
    signer: scenario.alice,
    subjectId: "bob",
  });
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
    ).rejects.toMatchObject({ code: "rollback" });
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

test("an intermediate path element newer than its checkpoint must cite the served heads above it", async () => {
  const scenario = await createGrandchildScenario();
  const root3 = await grantBy({
    cited: [scenario.root2.manifestHash],
    previous: scenario.root2,
    signer: scenario.alice,
    subjectId: "bob",
  });
  // Committed while root2 was current; the leaf below it is unchanged.
  const middle2 = await grantBy({
    cited: [scenario.root2.manifestHash, scenario.middle.manifestHash],
    previous: scenario.middle,
    signer: scenario.alice,
    subjectId: "bob",
  });
  const { close, execSql } = await createTestExecSql("ancestor-middle");
  try {
    const [, checkpointedMiddle] = await verifyPath(scenario, execSql, {
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
      verifyPath(scenario, execSql, {
        bundles: [
          scenario.root1,
          scenario.root2,
          root3,
          scenario.middle,
          middle2,
          scenario.leaf,
        ],
        path: [root3, middle2, scenario.leaf],
      }),
    ).rejects.toMatchObject({
      code: "rollback",
      message: expect.stringContaining("path[1]"),
    });
  } finally {
    close();
  }
});
