import { KeyingVerificationError } from "@tearleads/crypto";
import type {
  PrincipalPolicySnapshotResponse,
  PrincipalStatePayloadResponse,
  ProjectionPolicyEvidenceResponse,
} from "@tearleads/validators/response";

function newer(
  previous: PrincipalPolicySnapshotResponse | null | undefined,
  next: PrincipalPolicySnapshotResponse,
): boolean {
  if (!previous) return true;
  if (previous.currentState.principalId !== next.currentState.principalId)
    throw new KeyingVerificationError(
      "object_mismatch",
      "Projection evidence crosses principals",
    );
  if (
    previous.currentState.version === next.currentState.version &&
    previous.currentState.stateHash !== next.currentState.stateHash
  )
    throw new KeyingVerificationError(
      "hash_mismatch",
      "Projection evidence contains conflicting heads",
    );
  return previous.currentState.version < next.currentState.version;
}

/** Combine proof material when locally composing projections; verification follows. */
export function mergeProjectionPolicyEvidence(
  evidence: readonly ProjectionPolicyEvidenceResponse[],
): ProjectionPolicyEvidenceResponse {
  let directory: ProjectionPolicyEvidenceResponse | undefined;
  const groups = new Map<string, PrincipalPolicySnapshotResponse>();
  const payloads = new Map<string, PrincipalStatePayloadResponse>();
  for (const proof of evidence) {
    const organization = proof.organization;
    if (organization && newer(directory?.organization, organization))
      directory = proof;
    for (const payload of proof.organizationPayloads) {
      const previous = payloads.get(payload.stateHash);
      if (
        previous &&
        (previous.principalId !== payload.principalId ||
          previous.principalType !== payload.principalType ||
          previous.ciphertext !== payload.ciphertext ||
          previous.ciphertextHash !== payload.ciphertextHash)
      )
        throw new KeyingVerificationError(
          "hash_mismatch",
          "Projection evidence contains conflicting directory payloads",
        );
      payloads.set(payload.stateHash, payload);
    }
    for (const group of proof.groups) {
      const prior = groups.get(group.currentState.principalId);
      if (newer(prior, group))
        groups.set(group.currentState.principalId, group);
    }
  }
  return {
    organization: directory?.organization ?? null,
    organizationPayloads: [...payloads.values()],
    groups: [...groups.values()],
  };
}
