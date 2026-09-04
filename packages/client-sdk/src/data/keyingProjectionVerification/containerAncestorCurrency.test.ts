import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  checkpointChildAt,
  checkpointRootAt,
  createGrandchildScenario,
  createScenario,
  grantBy,
  verifyPath,
} from "../../../test/helpers/ancestorCitationScenario";
import { advanceKeyingCheckpointsAtomically } from "../persistence/keyingCheckpointAdvancePersistence";

// A head newer than this device's checkpoint for its container must cite the
// ancestor heads the projection serves as current. Mallory, revoked at root2,
// can still sign a child event that cites root1, where she was admin; a
// device holding the child refuses it once root2 is served as current, and a
// device that also checkpointed root2 refuses root1 as served current, so the
// two checks compose. A device with no checkpoint for the child is at first
// contact with it (containerAncestorCitations.test.ts), and a later child
// event that cites the current heads recovers a refused head.

test("a head newer than the local checkpoint must cite the served current ancestor heads", async () => {
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
    signer: scenario.alice,
    subjectId: "bob",
  });
  const { close, execSql } = await createTestExecSql("ancestor-snapshot");
  try {
    await checkpointChildAt(scenario, execSql, scenario.child1, [
      scenario.root1,
      scenario.child1,
    ]);
    // A purge's authorizing path is the snapshot the purge cited, which no
    // later event can re-cite; the checkpoint check alone bounds it.
    const verified = await verifyPath(scenario, execSql, {
      bundles: [scenario.root1, scenario.root2, scenario.child1, child2],
      path: [scenario.root2, child2],
      requireCurrentAncestorCitations: false,
    });
    expect(verified).toHaveLength(2);
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
      code: "stale_citation",
      message: expect.stringContaining("path[1]"),
    });
  } finally {
    close();
  }
});
