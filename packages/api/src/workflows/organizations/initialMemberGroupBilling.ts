import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import type { OrganizationProvisioningRequest } from "@tearleads/validators/request";
import { reconcileOrganizationBillingSeats } from "../billing/organizationSeats";
import { recordFreeTrialInitialized } from "../billing/organizationTrialLifecycle";
import { storeVerifiedPrincipalPolicyInTransaction } from "../principals/storeVerifiedPrincipalPolicy";
import type { CreatedInitialOrganizationBilling } from "./initialBilling";
import { syncOrganizationRosterFromMemberReachability } from "./roster";

export async function storeInitialMemberGroupPolicy(
  tx: DatabaseTransaction,
  input: OrganizationProvisioningRequest,
): Promise<string> {
  const { initialGroupPolicy } = input.initialMemberGroup;
  const storedState = await storeVerifiedPrincipalPolicyInTransaction(
    {
      state: initialGroupPolicy.state,
      encryptedPayload: initialGroupPolicy.encryptedPayload,
      projection: initialGroupPolicy.projection,
      memberEnvelopes: initialGroupPolicy.memberEnvelopes,
    },
    tx,
  );

  return storedState.stateHash;
}

export async function syncInitialRosterAndBillingSeats(input: {
  readonly initialBilling: CreatedInitialOrganizationBilling;
  readonly initialMemberGroupStateHash: string;
  readonly organizationId: string;
  readonly provisioning: OrganizationProvisioningRequest;
  readonly tx: DatabaseTransaction;
}): Promise<void> {
  await syncOrganizationRosterFromMemberReachability({
    disabledByUserId: null,
    executor: input.tx,
    memberGroupId: input.provisioning.initialMemberGroup.groupId,
    organizationId: input.organizationId,
  });
  const trialSourceId = input.initialBilling.sourceId;
  await reconcileOrganizationBillingSeats({
    executor: input.tx,
    organizationId: input.organizationId,
    source:
      trialSourceId === null
        ? {
            sourceId: input.initialMemberGroupStateHash,
            sourcePrincipalId: input.provisioning.initialMemberGroup.groupId,
            sourcePrincipalType: "group",
            sourceType: "principal_state",
          }
        : {
            sourceId: trialSourceId,
            sourcePrincipalId: input.provisioning.initialMemberGroup.groupId,
            sourcePrincipalType: "group",
            sourceType: "billing_transition",
          },
  });
  if (
    trialSourceId !== null &&
    input.initialBilling.trialStartedAt !== null &&
    input.initialBilling.trialEndsAt !== null
  ) {
    await recordFreeTrialInitialized({
      executor: input.tx,
      organizationId: input.organizationId,
      sourceId: trialSourceId,
      trialEndsAt: input.initialBilling.trialEndsAt,
      trialStartedAt: input.initialBilling.trialStartedAt,
    });
  }
}
