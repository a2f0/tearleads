import { assertProjectionVerificationCurrent } from "../../data/keyingProjectionVerification/types";
import type { AuthoredPrincipalMutation } from "../../data/principals/principalMutationJournal";
import type { PrincipalMutationRecoveryApi } from "../../workflows/organizations/principalMutationJournalManagement";
import type { InternalRuntime } from "../workflowRuntime";
import { currentOrganizationMutation } from "./principalMutationScope";

export interface AbandonOrganizationPolicyMutationInput {
  readonly organizationId: string;
  readonly mutation: AuthoredPrincipalMutation;
  readonly acknowledgeUnknownOutcome: true;
}

export interface DiscardUnreadableOrganizationPolicyMutationInput {
  readonly organizationId: string;
  readonly recordId: string;
  readonly acknowledgeUnknownOutcome: true;
}

async function runRecovery<T>(
  service: InternalRuntime,
  organizationId: string,
  run: (api: PrincipalMutationRecoveryApi) => Promise<T>,
): Promise<T> {
  const active = currentOrganizationMutation(service);
  const { runtime, stillCurrent } = active;
  assertProjectionVerificationCurrent(
    () => stillCurrent() && runtime.auth.organizationId === organizationId,
  );
  const api: typeof runtime.apiClient & Partial<PrincipalMutationRecoveryApi> =
    runtime.apiClient;
  if (
    !api.readPendingPrincipalMutation ||
    !api.recoverPendingPrincipalMutation ||
    !api.abandonPendingPrincipalMutation ||
    !api.discardUnreadablePrincipalMutation
  )
    throw new Error("Principal mutation recovery is unavailable");
  const result = await run({
    readPendingPrincipalMutation: api.readPendingPrincipalMutation,
    recoverPendingPrincipalMutation: api.recoverPendingPrincipalMutation,
    abandonPendingPrincipalMutation: api.abandonPendingPrincipalMutation,
    discardUnreadablePrincipalMutation: api.discardUnreadablePrincipalMutation,
  });
  assertProjectionVerificationCurrent(stillCurrent);
  return result;
}

export function discardUnreadableOrganizationPolicyMutation(
  service: InternalRuntime,
  input: DiscardUnreadableOrganizationPolicyMutationInput,
) {
  return runRecovery(service, input.organizationId, (api) =>
    api.discardUnreadablePrincipalMutation(
      input.organizationId,
      input.recordId,
      input.acknowledgeUnknownOutcome,
    ),
  );
}

export function readPendingOrganizationPolicyMutation(
  service: InternalRuntime,
  organizationId: string,
) {
  return runRecovery(service, organizationId, (api) =>
    api.readPendingPrincipalMutation(organizationId),
  );
}

export function retryPendingOrganizationPolicyMutation(
  service: InternalRuntime,
  organizationId: string,
) {
  return runRecovery(service, organizationId, (api) =>
    api.recoverPendingPrincipalMutation(organizationId),
  );
}

export function abandonPendingOrganizationPolicyMutation(
  service: InternalRuntime,
  input: AbandonOrganizationPolicyMutationInput,
) {
  return runRecovery(service, input.organizationId, (api) =>
    api.abandonPendingPrincipalMutation(
      input.organizationId,
      input.mutation,
      input.acknowledgeUnknownOutcome,
    ),
  );
}
