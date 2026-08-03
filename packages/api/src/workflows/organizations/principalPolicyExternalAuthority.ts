import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { organizations } from "@tearleads/api-shared/schema";
import type { PrincipalStateExternalAuthority } from "@tearleads/crypto";
import { eq } from "drizzle-orm";
import {
  getCurrentPrincipalState,
  listCurrentPrincipalProjectionMembers,
} from "../../access/read/principalStateStore";

function authorityMatches(
  submitted: PrincipalStateExternalAuthority | null,
  current: PrincipalStateExternalAuthority,
): boolean {
  return (
    submitted?.principalType === current.principalType &&
    submitted.principalId === current.principalId &&
    submitted.version === current.version &&
    submitted.keyEpoch === current.keyEpoch &&
    submitted.stateHash === current.stateHash &&
    submitted.keyFingerprint === current.keyFingerprint
  );
}

export async function isCurrentOrganizationAdminAuthority(input: {
  readonly executor: DatabaseSession;
  readonly organizationId: string;
  readonly signerUserId: string;
  readonly submittedAuthority: PrincipalStateExternalAuthority | null;
}): Promise<boolean> {
  const [organization] = await input.executor
    .select({ adminGroupId: organizations.adminGroupId })
    .from(organizations)
    .where(eq(organizations.id, input.organizationId))
    .limit(1);
  if (!organization) {
    return false;
  }
  const state = await getCurrentPrincipalState(
    "group",
    organization.adminGroupId,
    input.executor,
  );
  if (!state) {
    return false;
  }
  const currentAuthority: PrincipalStateExternalAuthority = {
    principalType: "group",
    principalId: state.principalId,
    version: state.version,
    keyEpoch: state.keyEpoch,
    stateHash: state.stateHash,
    keyFingerprint: state.keyFingerprint,
  };
  if (!authorityMatches(input.submittedAuthority, currentAuthority)) {
    return false;
  }
  const projection = await listCurrentPrincipalProjectionMembers(
    "group",
    organization.adminGroupId,
    input.executor,
  );
  return projection.some(
    (member) => member.userId === input.signerUserId && member.role === "admin",
  );
}
