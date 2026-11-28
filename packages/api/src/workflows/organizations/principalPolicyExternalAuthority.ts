import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import type { PrincipalStateExternalAuthority } from "@tearleads/crypto";
import {
  getCurrentPrincipalState,
  listCurrentPrincipalProjectionMembers,
} from "../../access/read/principalStateStore";
import { loadOrganizationDescriptor } from "./organizationDescriptors";

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
  const organization = await loadOrganizationDescriptor(
    input.executor,
    input.organizationId,
  );
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
