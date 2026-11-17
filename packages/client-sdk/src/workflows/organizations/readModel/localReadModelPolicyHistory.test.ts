import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import type {
  OrganizationReadModelSnapshotResponse,
  PrincipalPolicyBundleResponse,
} from "@tearleads/validators/response";
import { organizationPrincipalPolicy } from "../../../../test/helpers/data/organizationReadModelFixtures";
import {
  organizationReadModelSnapshot,
  organizationReadModelUserId,
} from "../../../../test/helpers/data/organizationReadModelProjectionFixtures";
import { OrganizationReadModelRepository } from "../../../data/persistence/organizations/organizationReadModelRepository";
import { PrincipalPolicyBundleRepository } from "../../../data/persistence/principalPolicy/principalPolicyBundleRepository";
import { buildOrganizationPolicyHistory } from "../policyHistory/policyHistoryReadModel";
import {
  loadLocalOrganizationPolicyHistory,
  loadLocalOrganizationPolicyReference,
} from "./localReadModelDetails";

const ORGANIZATION_ID = organizationPrincipalPolicy.currentState.principalId;

function policySnapshot(
  bundle: PrincipalPolicyBundleResponse,
): OrganizationReadModelSnapshotResponse {
  const base = organizationReadModelSnapshot({
    currentUserId: organizationReadModelUserId,
    organizationId: ORGANIZATION_ID,
  });
  return {
    ...base,
    lanes: {
      ...base.lanes,
      organizationPolicy: {
        organizationId: ORGANIZATION_ID,
        currentState: {
          stateHash: bundle.currentState.stateHash,
          version: bundle.currentState.version,
          keyEpoch: bundle.currentState.keyEpoch,
          keyFingerprint: bundle.currentState.keyFingerprint,
          memberCount: bundle.currentState.memberCount,
        },
      },
    },
  };
}

test("local organization policy history is bound to the projected verified head", async () => {
  const { close, execSql } = await createTestExecSql(
    "organization-local-policy-history",
  );
  const repository = new OrganizationReadModelRepository(execSql);
  try {
    const bundle = organizationPrincipalPolicy;
    const initial = policySnapshot(bundle);
    await expect(
      repository.applyOrganizationReadModelResponse({
        currentUserId: organizationReadModelUserId,
        requestedCursor: null,
        response: initial,
      }),
    ).resolves.toBe("applied");
    await new PrincipalPolicyBundleRepository(
      execSql,
    ).savePrincipalPolicyBundle(bundle, ORGANIZATION_ID);

    const common = {
      currentUserId: organizationReadModelUserId,
      execSql,
      organizationId: ORGANIZATION_ID,
    };
    await expect(loadLocalOrganizationPolicyHistory(common)).resolves.toEqual(
      buildOrganizationPolicyHistory(bundle),
    );
    await expect(
      loadLocalOrganizationPolicyReference({
        ...common,
        principalId: ORGANIZATION_ID,
        principalType: "organization",
      }),
    ).resolves.toEqual({
      principalType: "organization",
      principalId: ORGANIZATION_ID,
      stateHash: bundle.currentState.stateHash,
      version: bundle.currentState.version,
      keyEpoch: bundle.currentState.keyEpoch,
      keyFingerprint: bundle.currentState.keyFingerprint,
    });

    await expect(
      repository.applyOrganizationReadModelResponse({
        currentUserId: organizationReadModelUserId,
        requestedCursor: initial.nextCursor,
        response: {
          version: 6,
          mode: "delta",
          organizationId: ORGANIZATION_ID,
          nextCursor: "cursor-new-organization-policy",
          hasMore: false,
          currentUser: { isOrgAdmin: true },
          lanes: {
            organizationPolicy: {
              organizationId: ORGANIZATION_ID,
              currentState: {
                ...initial.lanes.organizationPolicy.currentState,
                stateHash: "newer-organization-policy-state",
              },
            },
          },
        },
      }),
    ).resolves.toBe("applied");
    await expect(
      loadLocalOrganizationPolicyHistory(common),
    ).resolves.toBeNull();
  } finally {
    close();
  }
});
