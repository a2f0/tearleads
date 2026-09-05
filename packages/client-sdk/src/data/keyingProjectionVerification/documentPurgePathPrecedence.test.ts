import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  createScenario,
  manifestBundle,
  verifyPath,
} from "../../../test/helpers/ancestorCitationScenario";
import { advanceKeyingCheckpointsAtomically } from "../persistence/keyingCheckpointAdvancePersistence";
import { createProjectionCheckpointContext } from "./checkpointContext";
import { verifyPurgeContainerPaths } from "./documentPurgeProofVerification";

test("a purge dependency path cannot replace the checkpoint-enforced path for the same leaf", async () => {
  const scenario = await createScenario();
  const { root1, root2, child1 } = scenario;
  const database = await createTestExecSql("purge-path-precedence");
  try {
    const [verifiedRoot] = await verifyPath(scenario, database.execSql, {
      bundles: [root1, root2],
      path: [root2],
    });
    if (!verifiedRoot) throw new Error("Expected verified current root");
    await advanceKeyingCheckpointsAtomically({
      access: [{ head: verifiedRoot, predecessors: [] }],
      execSql: database.execSql,
      policies: [],
    });
    const verified = await verifyPurgeContainerPaths({
      authorizationEvidence: [],
      checkpointContext: createProjectionCheckpointContext({
        execSql: database.execSql,
      }),
      enforceLocalCheckpoints: true,
      principalPolicyCache: new Map(),
      proof: {
        authorizingContainerPath: [root2, child1].map(manifestBundle),
        documentContainerManifestHistory: [root1].map(manifestBundle),
        documentManifestContainerPaths: [[root1, child1].map(manifestBundle)],
      },
      resolveUserKey: scenario.resolveUserKey,
    });
    expect(
      verified.containerPathByManifestHash
        .get(child1.manifestHash)
        ?.map((head) => head.manifestHash),
    ).toEqual([root2.manifestHash, child1.manifestHash]);
    expect(
      verified.authorizingContainerPath.map((head) => head.manifestHash),
    ).toEqual([root2.manifestHash, child1.manifestHash]);
    expect(
      verified.containerPathByManifestHash
        .get(root1.manifestHash)
        ?.map((head) => head.manifestHash),
    ).toEqual([root1.manifestHash]);
  } finally {
    database.close();
  }
});
