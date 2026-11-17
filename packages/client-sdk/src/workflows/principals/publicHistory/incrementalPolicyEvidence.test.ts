import { expect, test } from "bun:test";
import { createNativeTestExecSql } from "@tearleads/test-utils";
import { createOrganizationHistoryFixture } from "../../../../test/helpers/data/organizationPolicyHistory";
import { principalPolicyHead } from "../../../../test/helpers/data/principalPolicyFixtures";
import { projectionPolicyWarmer } from "../../../../test/helpers/workflows/projectionPolicyWarmer";
import { verifyProjectionPolicyEvidence } from "../../../data/keyingProjectionVerification/principalPolicy/projectionPolicyEvidence";

test("projection evidence retains a deleted group's historical authorization", async () => {
  const data = await createOrganizationHistoryFixture();
  const database = createNativeTestExecSql();
  const projection = (deleted: boolean) => ({
    organizationId: data.organizationId,
    containerId: "fixture-container",
    path: [],
    containerKeks: [],
    policyEvidence: data.projectionEvidence(deleted),
  });
  const verify = (value: ReturnType<typeof projection>) =>
    verifyProjectionPolicyEvidence({
      organizationId: data.organizationId,
      references: [principalPolicyHead(data.created)],
      warmReferencedPrincipalPolicies: projectionPolicyWarmer({
        execSql: database.execSql,
        bundles: data.projectionBundles,
        resolveUserKey: data.resolveTrustedUserIdentity,
      }),
      evidence: value.policyEvidence,
    });
  try {
    await verify(projection(false));
    const { policies } = await verify(projection(true));
    expect(
      policies.some(
        (policy) => policy.stateHash === data.added.currentState.stateHash,
      ),
    ).toBe(true);
  } finally {
    database.close();
  }
});
