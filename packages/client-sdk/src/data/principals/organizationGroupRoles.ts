import {
  computePrincipalStateHash,
  computePrincipalStatePayloadCiphertextHash,
} from "@tearleads/crypto";
import { KeyingCheckpointRepository } from "../persistence/keyingCheckpoints/keyingCheckpointRepository";
import { loadPrincipalPolicyBundle } from "../persistence/principalPolicy/principalPolicyPersistence";
import type { ExecSql } from "../sqlite/sqlSchema";
import { parseOrganizationAuthorityDescriptor } from "./organizationAuthorityDescriptor";

/** Public labels come only from a descriptor pinned by prior verification. */
export async function loadVerifiedOrganizationGroupRoles(
  execSql: ExecSql,
  organizationId: string,
): Promise<ReadonlyMap<string, string>> {
  const checkpoint = await new KeyingCheckpointRepository(
    execSql,
  ).loadPrincipalPolicyCheckpoint("organization", organizationId);
  const bundle = await loadPrincipalPolicyBundle(
    execSql,
    "organization",
    organizationId,
  );
  if (!checkpoint || !bundle) return new Map();
  const state = bundle.currentState;
  if (
    state.principalType !== "organization" ||
    state.principalId !== organizationId ||
    state.version !== checkpoint.version ||
    state.stateHash !== checkpoint.stateHash ||
    (await computePrincipalStateHash(state)) !== checkpoint.stateHash ||
    (await computePrincipalStatePayloadCiphertextHash(
      bundle.currentPayload.ciphertext,
    )) !== state.payloadCiphertextHash
  )
    return new Map();
  const descriptor = parseOrganizationAuthorityDescriptor(
    bundle.currentPayload.ciphertext,
  );
  if (descriptor.organizationId !== organizationId) return new Map();
  return new Map([
    [descriptor.adminGroupId, "Admins"],
    [descriptor.memberGroupId, "Members"],
  ]);
}
