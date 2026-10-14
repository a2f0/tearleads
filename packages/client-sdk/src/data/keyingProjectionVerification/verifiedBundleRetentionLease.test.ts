import { expect, test } from "bun:test";
import { createNativeTestExecSql } from "@tearleads/test-utils";
import {
  organizationPolicyBundleFromInitialRequest,
  policyBundleFromInitialRequest,
} from "../../../test/helpers/principalPolicyFixtures";
import {
  projectionDirectoryPayload,
  projectionPolicySource,
  projectionPolicyWarmer,
} from "../../../test/helpers/projectionPolicyHistory";
import { sharedReplacementBindingFixture } from "../../../test/helpers/sharedReplacementBinding";
import { rootContainerWriterProjectionFromCreatePlan } from "../../workflows/containers/root/create";
import { savePrincipalPolicyBundle } from "../persistence/principalPolicyPersistence";
import type { ExecSql } from "../sqlite/sqlSchema";
import { verifyContainerDestinationProjection } from "./containerDestinationVerification";
import {
  collectContainerWriterProjectionPrincipalPolicies,
  verifyContainerWriterProjection,
} from "./containerProjectionVerification";
import { isProjectionVerificationCancelledError } from "./types";

const verifiers = [
  ["projection", verifyContainerWriterProjection],
  ["policy collection", collectContainerWriterProjectionPrincipalPolicies],
  ["destination", verifyContainerDestinationProjection],
] as const;

for (const [entry, verify] of verifiers) {
  test(`container ${entry} verification rechecks its policy-history lease after the bundle write`, async () => {
    const setup = createNativeTestExecSql();
    const cold = createNativeTestExecSql();
    try {
      const data = await sharedReplacementBindingFixture(setup.execSql);
      const artifacts = data.replacement;
      const groups = await Promise.all(
        [artifacts.initialAdminGroup, artifacts.initialMemberGroup].map(
          policyBundleFromInitialRequest,
        ),
      );
      const organization = await organizationPolicyBundleFromInitialRequest(
        artifacts.organizationId,
        artifacts.initialOrganizationPolicy,
      );
      const projection = {
        ...rootContainerWriterProjectionFromCreatePlan(
          artifacts.rootContainer.plan,
        ),
        policyEvidence: {
          organization: projectionPolicySource(organization),
          organizationPayloads: [projectionDirectoryPayload(organization)],
          groups: groups.map(projectionPolicySource),
        },
      };
      const warmer = projectionPolicyWarmer({
        execSql: cold.execSql,
        bundles: [organization, ...groups],
        resolveUserKey: data.input.runtime.resolveTrustedUserIdentity,
      });
      const recover = warmer.resolveProjectionHistory;
      // Policy collection reads the current group policies this device holds.
      for (const bundle of groups)
        await savePrincipalPolicyBundle(
          cold.execSql,
          bundle,
          bundle.currentState.createdAt,
          artifacts.organizationId,
        );
      if (!recover) throw new Error("Missing recovery capability");
      // The lease, not the caller's generation, expires while the verified
      // bundles are being written: every earlier check passes.
      let leaseCurrent = true;
      const execSql = (async (...args: Parameters<ExecSql>) => {
        if (args[0].includes("verified_access_manifest_bundles"))
          leaseCurrent = false;
        return cold.execSql(...args);
      }) as ExecSql;
      const error = await verify({
        execSql,
        projection,
        stillCurrent: () => true,
        // Current policies warm as usual; the projection's history lease is
        // the one that lapses.
        warmReferencedPrincipalPolicies: Object.assign(
          (...args: Parameters<typeof warmer>) => warmer(...args),
          {
            resolveProjectionHistory: async (
              input: Parameters<typeof recover>[0],
            ) => ({
              ...(await recover(input)),
              stillCurrent: () => leaseCurrent,
            }),
          },
        ),
        resolveUserKey: data.input.runtime.resolveTrustedUserIdentity,
      }).then(
        () => null,
        (failure: unknown) => failure,
      );
      expect(leaseCurrent).toBe(false);
      expect(isProjectionVerificationCancelledError(error)).toBe(true);
    } finally {
      setup.close();
      cold.close();
    }
  });
}
