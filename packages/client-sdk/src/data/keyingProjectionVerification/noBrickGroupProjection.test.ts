import { expect, test } from "bun:test";
import type { VerifiedContainerAccessManifest } from "@tearleads/crypto";
import {
  createNativeTestExecSql,
  createNoBrickTraceRecorder,
  persistNoBrickTrace,
} from "@tearleads/test-utils";
import {
  grantBy,
  manifestBundle,
} from "../../../test/helpers/ancestorCitationScenario";
import { createGroupHistoricalSignerScenario } from "../../../test/helpers/groupHistoricalSignerScenario";
import { advanceKeyingCheckpointsAtomically } from "../persistence/keyingCheckpointAdvancePersistence";
import { createProjectionCheckpointContext } from "./checkpointContext";
import { verifyContainerManifestPath } from "./containerPathVerification";
import { principalPolicyCacheForVerifiedPolicies } from "./principalPolicyCache";

test("a cold device accepts a child signed by a since-removed group admin", async () => {
  const scenario = await createGroupHistoricalSignerScenario();
  const { child2, mallory, root2 } = scenario;
  const bundles = [scenario.root1, root2, scenario.child1, child2].map(
    manifestBundle,
  );
  const { close, execSql } = createNativeTestExecSql();
  const recorder = createNoBrickTraceRecorder("container-group-late-delivery", {
    d1: 0,
  });
  recorder.record({ action: "CommitDependent", late: true });
  recorder.record({ action: "RevokeLateSigner" });
  try {
    const verifiedByHash = new Map<string, VerifiedContainerAccessManifest>();
    const verificationInput = {
      servedAsCurrent: true,
      bundlesByHash: new Map(
        bundles.map((bundle) => [bundle.manifestHash, bundle]),
      ),
      checkpointContext: createProjectionCheckpointContext({ execSql }),
      enforceLocalCheckpoints: true,
      label: "Late group-authored child",
      path: [root2, child2].map(manifestBundle),
      principalPolicyCache: principalPolicyCacheForVerifiedPolicies([
        scenario.policy,
      ]),
      resolveUserKey: scenario.resolveUserKey,
      verifiedByHash,
    } satisfies Parameters<typeof verifyContainerManifestPath>[0];
    const path = await verifyContainerManifestPath(verificationInput);
    await advanceKeyingCheckpointsAtomically({
      access: path.map((head) => ({
        head,
        predecessors: [...verifiedByHash.values()]
          .filter(
            (entry) =>
              entry.state.containerId === head.state.containerId &&
              entry.state.epoch < head.state.epoch,
          )
          .sort((left, right) => left.state.epoch - right.state.epoch),
      })),
      execSql,
      policies: [],
    });
    recorder.record({
      action: "HonestSync",
      device: "d1",
      observed: { outcome: "accepted" },
    });
    expect(path.at(-1)?.manifestHash).toBe(child2.manifestHash);
    const forged = await grantBy({
      cited: [root2.manifestHash, child2.manifestHash],
      previous: child2,
      signer: mallory,
      subjectId: scenario.peer.userId,
    });
    await expect(
      verifyContainerManifestPath({
        ...verificationInput,
        bundlesByHash: new Map(
          [...bundles, manifestBundle(forged)].map((bundle) => [
            bundle.manifestHash,
            bundle,
          ]),
        ),
        path: [root2, forged].map(manifestBundle),
        verifiedByHash: new Map(),
      }),
    ).rejects.toMatchObject({ code: "unauthorized" });
    recorder.record({
      action: "Verify",
      device: "d1",
      projection: {
        authority: root2.state.epoch,
        cited: root2.state.epoch,
        head: forged.state.epoch,
        honestPrefix: child2.state.epoch,
        late: true,
      },
      observed: { outcome: "refused" },
    });
    persistNoBrickTrace(recorder.trace());
  } finally {
    close();
  }
});
