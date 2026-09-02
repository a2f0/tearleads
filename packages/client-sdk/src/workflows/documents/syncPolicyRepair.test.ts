import { expect, test } from "bun:test";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { DOCUMENT_SYNC_ERROR_CODES } from "@tearleads/validators/response";
import type { DocumentSyncPlan } from "../../data/documents/shared/types";
import type { ReferencedPrincipalPolicyWarmer } from "../../data/keyingProjectionVerification";
import { cacheDocumentSyncPolicyRepair } from "./syncPolicyRepair";

function policyBundle(
  principalType: "group" | "organization",
  principalId: string,
): PrincipalPolicyBundleResponse {
  return {
    currentState: { principalId, principalType },
  } as PrincipalPolicyBundleResponse;
}

function repairPlan(): DocumentSyncPlan {
  return {
    organizationId: "organization-1",
    request: {
      containerRekeys: [
        {
          principalPolicies: [
            { principalId: "group-1", principalType: "group" },
          ],
        },
      ],
    },
  } as unknown as DocumentSyncPlan;
}

function staleFailure(bundles: readonly PrincipalPolicyBundleResponse[]) {
  return {
    code: DOCUMENT_SYNC_ERROR_CODES.stateStale,
    message: "Principal policy is stale",
    ok: false as const,
    report: () => undefined,
    stalePrincipalPolicies: bundles,
    status: 409,
  };
}

test("document sync caches only requested stale-policy repair identities", async () => {
  const requested = policyBundle("group", "group-1");
  let cachedBundles: readonly PrincipalPolicyBundleResponse[] = [];
  const warmer = Object.assign(async () => undefined, {
    cacheBundles: async (input: {
      bundles: readonly PrincipalPolicyBundleResponse[];
    }) => {
      cachedBundles = input.bundles;
    },
  }) satisfies ReferencedPrincipalPolicyWarmer;

  await cacheDocumentSyncPolicyRepair({
    failure: staleFailure([requested]),
    plan: repairPlan(),
    warmReferencedPrincipalPolicies: warmer,
  });

  expect(cachedBundles).toEqual([requested]);
});

test("document sync rejects an unrequested policy bundle before caching", async () => {
  const requested = policyBundle("group", "group-1");
  const unrequested = policyBundle("group", "group-from-other-organization");
  let cacheCalled = false;
  const warmer = Object.assign(async () => undefined, {
    cacheBundles: async () => {
      cacheCalled = true;
    },
  }) satisfies ReferencedPrincipalPolicyWarmer;

  await expect(
    cacheDocumentSyncPolicyRepair({
      failure: staleFailure([requested, unrequested]),
      plan: repairPlan(),
      warmReferencedPrincipalPolicies: warmer,
    }),
  ).rejects.toMatchObject({
    code: "object_mismatch",
    message: "Document sync policy repair bundle principal was not requested",
  });
  expect(cacheCalled).toBe(false);
});
