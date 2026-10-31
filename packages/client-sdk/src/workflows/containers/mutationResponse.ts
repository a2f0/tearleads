import type { ContainerAccessManifestState } from "@tearleads/crypto";
import type { ReferencedPrincipalStateResponse } from "@tearleads/validators/response";

/**
 * Acknowledgements carry hashes, not the signed state, so the state a client
 * records after one comes from the plan it signed and the hashes it matched.
 */
export function signedContainerMetadataDocumentId(input: {
  readonly state: Pick<ContainerAccessManifestState, "metadataDocumentId">;
}): string {
  const { metadataDocumentId } = input.state;
  if (metadataDocumentId.length === 0) {
    throw new Error("Container mutation plan is missing metadata state");
  }
  return metadataDocumentId;
}

export function signedContainerReferencedPrincipalHeads(input: {
  readonly state: Pick<
    ContainerAccessManifestState,
    "referencedPrincipalHeads"
  >;
}): ReferencedPrincipalStateResponse[] {
  return input.state.referencedPrincipalHeads.map((head) => ({
    principalType: head.principalType,
    principalId: head.principalId,
    version: head.version,
    keyEpoch: head.keyEpoch,
    stateHash: head.stateHash,
    keyFingerprint: head.keyFingerprint,
  }));
}
