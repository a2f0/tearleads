import { KeyingVerificationError } from "@tearleads/crypto";
import type { ReferencedPrincipalStateResponse } from "@tearleads/validators/response";
import { isRetryableDocumentSyncConflict } from "../../data/documents/shared/responses";
import type {
  DocumentSyncPlan,
  DocumentSyncSubmitFailure,
} from "../../data/documents/shared/types";
import type { ReferencedPrincipalPolicyWarmer } from "../../data/keyingProjectionVerification";

import { recoverPrincipalPolicyRepair } from "../principals/policyRepair";

type ManagedPrincipalType = "group" | "organization";

function principalIdentityKey(
  principalType: ManagedPrincipalType,
  principalId: string,
): string {
  return `${principalType}:${principalId}`;
}

function requestedRepairPrincipalIdentities(
  plan: DocumentSyncPlan,
): Set<string> {
  const identities = new Set<string>();
  for (const rekey of plan.request.containerRekeys ?? []) {
    for (const policy of rekey.principalPolicies) {
      const principalType = Reflect.get(policy, "principalType");
      const principalId = Reflect.get(policy, "principalId");
      if (
        (principalType === "group" || principalType === "organization") &&
        typeof principalId === "string" &&
        principalId.length > 0
      ) {
        identities.add(principalIdentityKey(principalType, principalId));
      }
    }
  }
  return identities;
}

function assertDocumentSyncPolicyRepairHeadsRequested(input: {
  readonly heads: readonly ReferencedPrincipalStateResponse[];
  readonly plan: DocumentSyncPlan;
}): void {
  const requested = requestedRepairPrincipalIdentities(input.plan);
  for (const head of input.heads) {
    const { principalId, principalType } = head;
    if (!requested.has(principalIdentityKey(principalType, principalId))) {
      throw new KeyingVerificationError(
        "object_mismatch",
        "Document sync policy repair head principal was not requested",
      );
    }
  }
}

export async function recoverDocumentSyncPolicyRepair(input: {
  failure: DocumentSyncSubmitFailure;
  plan: DocumentSyncPlan;
  stillCurrent?: (() => boolean) | undefined;
  warmReferencedPrincipalPolicies?: ReferencedPrincipalPolicyWarmer | undefined;
}): Promise<void> {
  const heads = input.failure.stalePrincipalHeads;
  const resolve = input.warmReferencedPrincipalPolicies?.resolveReference;
  if (
    !isRetryableDocumentSyncConflict(input.failure) ||
    (input.plan.request.containerRekeys?.length ?? 0) === 0 ||
    !heads ||
    heads.length === 0 ||
    !resolve ||
    input.stillCurrent?.() === false
  ) {
    return;
  }

  assertDocumentSyncPolicyRepairHeadsRequested({ heads, plan: input.plan });
  await recoverPrincipalPolicyRepair({
    heads,
    warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
    organizationId: input.plan.organizationId,
    stillCurrent: input.stillCurrent,
  });
}
