import { expect, test } from "bun:test";
import { runGroupShareScenario } from "../../../../../test/helpers/groupShareScenario";
import { ProjectionDependencyUnavailableError } from "../../../../data/keyingProjectionVerification/dependencyUnavailable";
import { createContainerContentsWorkflowRuntime } from "../../runtime";
import { shareRemoteContainerWithGroup } from "../remote";

// The app's group share runs through the runtime path
// (createRuntimeCurrentGroupShare), wired to the replan by one line that the
// helper and exported-workflow tests cannot see. Its group evidence can trail
// a checkpoint another workflow pinned meanwhile; the share must plan once
// more there. This scenario's synthetic projection stops the replanned attempt
// at manifest verification, so it pins the replan itself; a completed share
// after a replan is covered by shareGroupStaleEvidence.test.ts.
async function shareThroughRuntime(staleReads: number) {
  let evictions = 0;
  let outcome: unknown;
  const scenario = await runGroupShareScenario({
    currentGroupKeyEpoch: 2,
    currentPolicyError: new ProjectionDependencyUnavailableError(
      "Public history cannot connect to the newer durable checkpoint",
    ),
    currentPolicyErrorReads: staleReads,
    pinnedKeyEpoch: 1,
    remoteAccessStateHash: `remote-access-state-hash-stale-${staleReads}`,
    testLabel: `containerContents-share-group-stale-${staleReads}`,
    writerContext: true,
    runShare: async ({ containerState, expectedGroupName, runtimeInput }) => {
      const api = runtimeInput.apiClient;
      api.evictContainerWriterProjection = () => {
        evictions += 1;
      };
      const containerId = containerState.container.id;
      const previousProjection =
        await api.getContainerWriterProjection(containerId);
      if (!previousProjection) throw new Error("Expected a projection");
      outcome = await shareRemoteContainerWithGroup({
        accessLevel: "read",
        containerId,
        expectedGroupName,
        previousProjection,
        recipientGroupId: "members-group",
        resolveProjectionUserKey: async () => null,
        runtime: createContainerContentsWorkflowRuntime(runtimeInput),
      }).catch((error: unknown) => error);
    },
  });
  return { evictions, outcome, scenario };
}

test("the runtime group share replans once after stale group evidence", async () => {
  const { evictions, outcome, scenario } = await shareThroughRuntime(1);
  // One stale plan, one eviction, one fresh plan that reads the group again.
  expect(outcome).not.toBeInstanceOf(ProjectionDependencyUnavailableError);
  expect(evictions).toBe(1);
  expect(scenario.currentPolicyCalls).toHaveLength(2);
});

test("the runtime group share fails when its evidence stays stale", async () => {
  const { evictions, outcome, scenario } = await shareThroughRuntime(99);
  expect(outcome).toBeInstanceOf(ProjectionDependencyUnavailableError);
  expect(evictions).toBe(1);
  expect(scenario.currentPolicyCalls).toHaveLength(2);
  expect(scenario.shareCallCount).toBe(0);
});
