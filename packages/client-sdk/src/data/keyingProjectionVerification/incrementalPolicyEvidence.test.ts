import { expect, test } from "bun:test";
import {
  captureProjectionHistory,
  omitProjectionHistory,
  restoreProjectionHistory,
} from "@tearleads/crypto";
import { createNativeTestExecSql } from "@tearleads/test-utils";
import { createOrganizationHistoryFixture } from "../../../test/helpers/organizationPolicyHistory";
import { principalPolicyHead } from "../../../test/helpers/principalPolicyFixtures";
import { projectionPolicyWarmer } from "../../../test/helpers/projectionPolicyHistory";
import { verifyProjectionPolicyEvidence } from "./projectionPolicyEvidence";

test("incremental evidence retains a deleted group's historical authorization and rejects modified cached prefixes", async () => {
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
    const initial = projection(false);
    await verify(initial);
    const retained = captureProjectionHistory(initial);
    const full = projection(true);
    const wire = omitProjectionHistory(
      full,
      retained.map((entry) => entry.prefix),
    );
    expect(JSON.stringify(wire).length).toBeLessThan(
      JSON.stringify(full).length,
    );
    expect(restoreProjectionHistory(wire, retained)).toBe(true);
    const { policies: expected } = await verify(full);
    const { policies: actual } = await verify(wire);
    expect(actual.map((policy) => policy.stateHash)).toEqual(
      expected.map((policy) => policy.stateHash),
    );
    expect(
      actual.some(
        (policy) => policy.stateHash === data.added.currentState.stateHash,
      ),
    ).toBe(true);
    const corrupted = structuredClone(retained);
    const first = corrupted[0];
    if (!first) throw new Error("Expected cached prefix");
    Object.assign(first, { values: ["forged"] });
    expect(
      restoreProjectionHistory(
        omitProjectionHistory(
          full,
          retained.map((entry) => entry.prefix),
        ),
        corrupted,
      ),
    ).toBe(false);
  } finally {
    database.close();
  }
});
