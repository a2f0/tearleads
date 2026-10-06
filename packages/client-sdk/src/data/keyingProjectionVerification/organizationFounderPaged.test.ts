import { expect, test } from "bun:test";
import { createNativeTestExecSql } from "@tearleads/test-utils";
import {
  organizationPolicyBundleFromInitialRequest,
  policyBundleFromInitialRequest,
  principalPolicyHead,
} from "../../../test/helpers/principalPolicyFixtures";
import {
  projectionDirectoryPayload,
  projectionPolicySource,
  projectionPolicyWarmer,
} from "../../../test/helpers/projectionPolicyHistory";
import { sharedReplacementBindingFixture } from "../../../test/helpers/sharedReplacementBinding";
import { rootContainerWriterProjectionFromCreatePlan } from "../../workflows/containers/root/create";
import { recoverPrincipalPolicyHistory } from "../../workflows/principals/recoverPrincipalPolicyHistory";
import { loadOrganizationFounder } from "../persistence/organizationFounderPersistence";
import { verifyContainerDestinationProjection } from "./containerDestinationVerification";
import { rememberRootBoundOrganizationFounder } from "./organizationFounderBinding";

test("paged organization evidence pins the genuine root's founder", async () => {
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
    const verified = await verifyContainerDestinationProjection({
      execSql: setup.execSql,
      warmReferencedPrincipalPolicies: projectionPolicyWarmer({
        execSql: setup.execSql,
        bundles: [organization, ...groups],
        resolveUserKey: data.input.runtime.resolveTrustedUserIdentity,
      }),
      projection: {
        ...rootContainerWriterProjectionFromCreatePlan(
          artifacts.rootContainer.plan,
        ),
        policyEvidence: {
          organization: projectionPolicySource(organization),
          organizationPayloads: [projectionDirectoryPayload(organization)],
          groups: groups.map(projectionPolicySource),
        },
      },
      resolveUserKey: data.input.runtime.resolveTrustedUserIdentity,
    });
    const recovered = await recoverPrincipalPolicyHistory({
      apiClient: {
        async *getPrincipalPolicyPages() {
          yield {
            ok: true as const,
            data: {
              ...organization,
              historyPage: { afterVersion: 0, nextAfterVersion: null },
            },
          };
        },
      },
      execSql: cold.execSql,
      organizationId: artifacts.organizationId,
      expectedHead: principalPolicyHead(organization),
      protection: {
        localKey: new Uint8Array(32).fill(7),
        context: "founder-test",
      },
      stillCurrent: () => true,
      resolveTrustedUserIdentity: data.input.runtime.resolveTrustedUserIdentity,
    });
    expect(
      await loadOrganizationFounder(cold.execSql, artifacts.organizationId),
    ).toBeNull();
    await rememberRootBoundOrganizationFounder({
      execSql: cold.execSql,
      policies: [recovered.policy],
      root: verified.path[0],
      verifiedByHash: verified.verifiedByHash,
    });
    expect(
      await loadOrganizationFounder(cold.execSql, artifacts.organizationId),
    ).toMatchObject({
      userId: data.userId,
      genesisStateHash: organization.currentState.stateHash,
    });
  } finally {
    setup.close();
    cold.close();
  }
});
