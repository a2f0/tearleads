import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import type { OrganizationProvisioningRequest } from "@tearleads/validators/request";
import { reconcileOrganizationBillingSeats } from "../billing/organizationSeats";
import { storeVerifiedPrincipalPolicyInTransaction } from "../principals/storeVerifiedPrincipalPolicy";
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
  await reconcileOrganizationBillingSeats({
    executor: input.tx,
    organizationId: input.organizationId,
    source: {
      sourceId: input.initialMemberGroupStateHash,
      sourcePrincipalId: input.provisioning.initialMemberGroup.groupId,
      sourcePrincipalType: "group",
      sourceType: "principal_state",
    },
  });
}
