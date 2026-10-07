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
import {
  loadAccessManifestCheckpoint,
  loadPrincipalPolicyCheckpoint,
} from "../persistence/keyingCheckpointPersistence";
import { verifyContainerDestinationProjection } from "./containerDestinationVerification";
import { isProjectionVerificationCancelledError } from "./types";

for (const change of ["none", "caller", "lease", "fork", "newer"] as const) {
  test(`destination admission rechecks ${change} after asynchronous manifest verification`, async () => {
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
      if (!recover) throw new Error("Missing recovery capability");
      let recovered = false;
      let resolvedManifest = false;
      let callerCurrent = true;
      let leaseCurrent = true;
      const result = await verifyContainerDestinationProjection({
        execSql: cold.execSql,
        projection,
        stillCurrent: () => callerCurrent,
        warmReferencedPrincipalPolicies: Object.assign(async () => {}, {
          resolveProjectionHistory: async (
            input: Parameters<typeof recover>[0],
          ) => {
            const selection = await recover(input);
            recovered = true;
            return { ...selection, stillCurrent: () => leaseCurrent };
          },
        }),
        resolveUserKey: async (userId) => {
          const identity =
            await data.input.runtime.resolveTrustedUserIdentity(userId);
          if (recovered && !resolvedManifest) {
            resolvedManifest = true;
            if (change === "caller") callerCurrent = false;
            if (change === "lease") leaseCurrent = false;
            if (change === "fork" || change === "newer")
              await cold.execSql(
                `INSERT INTO principal_policy_checkpoints (principal_type, principal_id, version, state_hash, updated_at) VALUES (?, ?, ?, ?, ?)`,
                [
                  "organization",
                  artifacts.organizationId,
                  organization.currentState.version +
                    (change === "newer" ? 1 : 0),
                  "f".repeat(64),
                  organization.currentState.createdAt,
                ],
              );
          }
          return identity;
        },
      }).then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      expect(resolvedManifest).toBe(true);
      if (change === "none") {
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.value.path).toHaveLength(1);
      } else {
        expect(result.ok).toBe(false);
        if (!result.ok) {
          if (change === "caller" || change === "lease")
            expect(isProjectionVerificationCancelledError(result.error)).toBe(
              true,
            );
          else if (change === "fork")
            expect(result.error).toMatchObject({ code: "equivocation" });
          else
            expect(result.error).toMatchObject({
              name: "ProjectionDependencyUnavailableError",
            });
        }
      }
      expect(
        await loadAccessManifestCheckpoint(
          cold.execSql,
          "container",
          artifacts.organizationId,
          projection.containerId,
        ),
      ).toBeNull();
      const pin = await loadPrincipalPolicyCheckpoint(
        cold.execSql,
        "organization",
        artifacts.organizationId,
      );
      if (change === "fork" || change === "newer")
        expect(pin?.stateHash).toBe("f".repeat(64));
      else expect(pin).toBeNull();
    } finally {
      setup.close();
      cold.close();
    }
  });
}
