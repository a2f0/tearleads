import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import type {
  OrganizationReadModelSnapshotResponse,
  PrincipalPolicyBundleResponse,
} from "@tearleads/validators/response";
import { organizationPrincipalPolicy } from "../../../test/helpers/organizationReadModelFixtures";
import {
  organizationReadModelSnapshot,
  organizationReadModelUserId,
} from "../../../test/helpers/organizationReadModelProjectionFixtures";
import { applyOrganizationReadModelResponse } from "../../data/persistence/organizations/organizationReadModelPersistence";
import { savePrincipalPolicyBundle } from "../../data/persistence/principalPolicyPersistence";
import {
  loadLocalOrganizationPolicyHistory,
  loadLocalOrganizationPolicyReference,
} from "./localReadModelDetails";
import { buildOrganizationPolicyHistory } from "./policyHistoryReadModel";

const CREATED_AT = "2026-07-17T12:00:00.000Z";
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
  try {
    const bundle = organizationPrincipalPolicy;
    const initial = policySnapshot(bundle);
    await expect(
      applyOrganizationReadModelResponse({
        currentUserId: organizationReadModelUserId,
        execSql,
        requestedCursor: null,
        response: initial,
      }),
    ).resolves.toBe("applied");
    await savePrincipalPolicyBundle(execSql, bundle, CREATED_AT);

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
      applyOrganizationReadModelResponse({
        currentUserId: organizationReadModelUserId,
        execSql,
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
