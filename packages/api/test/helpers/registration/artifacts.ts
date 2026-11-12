import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  containers,
  groups,
  organizationBilling,
  organizationReadModelHeads,
  organizationRosterEntries,
  organizations,
  principalHistoryProgress,
  principalMemberEnvelopes,
  principalMembershipProjection,
  principalStatePayloads,
  principalStates,
  users,
} from "@tearleads/api-shared/schema";
import type { RegistrationRequest } from "@tearleads/validators/request";
import { eq, inArray } from "drizzle-orm";

/** Read through the supplied transaction to distinguish staging from no-op rejection. */
export async function readRegistrationArtifacts(
  executor: DatabaseSession,
  request: RegistrationRequest,
) {
  const principalIds = [
    request.organizationId,
    request.initialAdminGroup.groupId,
    request.initialMemberGroup.groupId,
  ];
  return {
    users: await executor
      .select()
      .from(users)
      .where(eq(users.id, request.userId)),
    organizations: await executor
      .select()
      .from(organizations)
      .where(eq(organizations.id, request.organizationId)),
    billing: await executor
      .select()
      .from(organizationBilling)
      .where(eq(organizationBilling.organizationId, request.organizationId)),
    groups: await executor
      .select()
      .from(groups)
      .where(eq(groups.organizationId, request.organizationId)),
    containers: await executor
      .select()
      .from(containers)
      .where(eq(containers.organizationId, request.organizationId)),
    states: await executor
      .select()
      .from(principalStates)
      .where(inArray(principalStates.principalId, principalIds)),
    payloads: await executor
      .select()
      .from(principalStatePayloads)
      .where(inArray(principalStatePayloads.principalId, principalIds)),
    projection: await executor
      .select()
      .from(principalMembershipProjection)
      .where(inArray(principalMembershipProjection.principalId, principalIds)),
    envelopes: await executor
      .select()
      .from(principalMemberEnvelopes)
      .where(inArray(principalMemberEnvelopes.principalId, principalIds)),
    progress: await executor
      .select()
      .from(principalHistoryProgress)
      .where(inArray(principalHistoryProgress.principalId, principalIds)),
    roster: await executor
      .select()
      .from(organizationRosterEntries)
      .where(
        eq(organizationRosterEntries.organizationId, request.organizationId),
      ),
    heads: await executor
      .select()
      .from(organizationReadModelHeads)
      .where(
        eq(organizationReadModelHeads.organizationId, request.organizationId),
      ),
  };
}
