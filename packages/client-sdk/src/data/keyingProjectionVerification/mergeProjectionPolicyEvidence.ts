import { KeyingVerificationError } from "@tearleads/crypto";
import type {
  PrincipalPolicyHistorySourceResponse,
  ProjectionPolicyEvidenceResponse,
} from "@tearleads/validators/response";
import { principalHeadMatchesReference } from "../principals/organizationAuthorityDescriptor";

function newer(
  previous: PrincipalPolicyHistorySourceResponse | null | undefined,
  next: PrincipalPolicyHistorySourceResponse,
): boolean {
  if (!previous) return true;
  if (previous.head.principalId !== next.head.principalId)
    throw new KeyingVerificationError(
      "object_mismatch",
      "Projection evidence crosses principals",
    );
  if (
    previous.head.version === next.head.version &&
    !principalHeadMatchesReference(previous.head, next.head)
  )
    throw new KeyingVerificationError(
      "hash_mismatch",
      "Projection evidence contains conflicting heads",
    );
  return previous.head.version < next.head.version;
}

/** Combine proof material when locally composing projections; verification follows. */
export function mergeProjectionPolicyEvidence(
  evidence: readonly ProjectionPolicyEvidenceResponse[],
): ProjectionPolicyEvidenceResponse {
  let directory: ProjectionPolicyEvidenceResponse | undefined;
  const groups = new Map<string, PrincipalPolicyHistorySourceResponse>();
  const payloads = new Map<
    string,
    ProjectionPolicyEvidenceResponse["organizationPayloads"][number]
  >();
  for (const proof of evidence) {
    const organization = proof.organization;
    if (organization && newer(directory?.organization, organization))
      directory = proof;
    for (const payload of proof.organizationPayloads) {
      const previous = payloads.get(payload.reference.stateHash);
      if (
        previous &&
        (!principalHeadMatchesReference(
          previous.reference,
          payload.reference,
        ) ||
          previous.payload.principalId !== payload.payload.principalId ||
          previous.payload.principalType !== payload.payload.principalType ||
          previous.payload.ciphertext !== payload.payload.ciphertext ||
          previous.payload.ciphertextHash !== payload.payload.ciphertextHash)
      )
        throw new KeyingVerificationError(
          "hash_mismatch",
          "Projection evidence contains conflicting directory payloads",
        );
      payloads.set(payload.reference.stateHash, payload);
    }
    for (const group of proof.groups) {
      const prior = groups.get(group.head.principalId);
      if (newer(prior, group)) groups.set(group.head.principalId, group);
    }
  }
  return {
    organization: directory?.organization ?? null,
    organizationPayloads: [...payloads.values()],
    groups: [...groups.values()],
  };
}
