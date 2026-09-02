import { KeyingVerificationError } from "@tearleads/crypto";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { isRetryableDocumentSyncConflict } from "../../data/documents/shared/responses";
import type {
  DocumentSyncPlan,
  DocumentSyncSubmitFailure,
} from "../../data/documents/shared/types";
import type { ReferencedPrincipalPolicyWarmer } from "../../data/keyingProjectionVerification";

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

function assertDocumentSyncPolicyRepairBundlesRequested(input: {
  readonly bundles: readonly PrincipalPolicyBundleResponse[];
  readonly plan: DocumentSyncPlan;
}): void {
  const requested = requestedRepairPrincipalIdentities(input.plan);
  for (const bundle of input.bundles) {
    const { principalId, principalType } = bundle.currentState;
    if (!requested.has(principalIdentityKey(principalType, principalId))) {
      throw new KeyingVerificationError(
        "object_mismatch",
        "Document sync policy repair bundle principal was not requested",
      );
    }
  }
}

export async function cacheDocumentSyncPolicyRepair(input: {
  failure: DocumentSyncSubmitFailure;
  plan: DocumentSyncPlan;
  stillCurrent?: (() => boolean) | undefined;
  warmReferencedPrincipalPolicies?: ReferencedPrincipalPolicyWarmer | undefined;
}): Promise<void> {
  const bundles = input.failure.stalePrincipalPolicies;
  const cacheBundles = input.warmReferencedPrincipalPolicies?.cacheBundles;
  if (
    !isRetryableDocumentSyncConflict(input.failure) ||
    (input.plan.request.containerRekeys?.length ?? 0) === 0 ||
    !bundles ||
    bundles.length === 0 ||
    !cacheBundles ||
    input.stillCurrent?.() === false
  ) {
    return;
  }

  assertDocumentSyncPolicyRepairBundlesRequested({ bundles, plan: input.plan });
  await cacheBundles({
    bundles,
    organizationId: input.plan.organizationId,
    stillCurrent: input.stillCurrent,
  });
}
