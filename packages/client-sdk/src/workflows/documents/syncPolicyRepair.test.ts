import { expect, test } from "bun:test";
import type { ReferencedPrincipalStateResponse } from "@tearleads/validators/response";
import { DOCUMENT_SYNC_ERROR_CODES } from "@tearleads/validators/response";
import { createAuthor } from "../../../test/helpers/containerFixtures";
import { principalRepairEvidence } from "../../../test/helpers/principalRepairEvidence";
import type { DocumentSyncPlan } from "../../data/documents/shared/types";
import type {
  PrincipalPolicyResolveRequest,
  ReferencedPrincipalPolicyWarmer,
} from "../../data/keyingProjectionVerification/types";
import { recoverDocumentSyncPolicyRepair } from "./syncPolicyRepair";

function repairPlan(
  organizationId: string,
  principalId: string,
): DocumentSyncPlan {
  return {
    organizationId,
    request: {
      containerRekeys: [
        { principalPolicies: [{ principalId, principalType: "group" }] },
      ],
    },
  } as unknown as DocumentSyncPlan;
}
function staleFailure(heads: readonly ReferencedPrincipalStateResponse[]) {
  return {
    code: DOCUMENT_SYNC_ERROR_CODES.stateStale,
    message: "Principal policy is stale",
    ok: false as const,
    report: () => undefined,
    stalePrincipalHeads: heads,
    status: 409,
  };
}

test("document sync recovers only requested stale-policy heads", async () => {
  const { head, evidence } = await principalRepairEvidence(
    await createAuthor(),
  );
  const resolved: PrincipalPolicyResolveRequest[] = [];
  const warmer = Object.assign(async () => undefined, {
    resolveReference: async (input: PrincipalPolicyResolveRequest) => {
      resolved.push(input);
      return evidence;
    },
  }) satisfies ReferencedPrincipalPolicyWarmer;
  await recoverDocumentSyncPolicyRepair({
    failure: staleFailure([head]),
    plan: repairPlan(evidence.organizationId, head.principalId),
    warmReferencedPrincipalPolicies: warmer,
  });
  expect(resolved).toHaveLength(1);
  expect(resolved[0]).toMatchObject({
    organizationId: evidence.organizationId,
    reference: head,
  });
});

test("document sync rejects an unrequested policy head before recovery", async () => {
  const { head, evidence } = await principalRepairEvidence(
    await createAuthor(),
  );
  let resolveCalled = false;
  const warmer = Object.assign(async () => undefined, {
    resolveReference: async () => {
      resolveCalled = true;
      return evidence;
    },
  }) satisfies ReferencedPrincipalPolicyWarmer;
  await expect(
    recoverDocumentSyncPolicyRepair({
      failure: staleFailure([head, { ...head, principalId: "other-group" }]),
      plan: repairPlan(evidence.organizationId, head.principalId),
      warmReferencedPrincipalPolicies: warmer,
    }),
  ).rejects.toMatchObject({
    code: "object_mismatch",
    message: "Document sync policy repair head principal was not requested",
  });
  expect(resolveCalled).toBe(false);
});
