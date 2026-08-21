import {
  isReferencedPrincipalStateResponse,
  type ReferencedPrincipalStateResponse,
} from "@symcrypt/validators/response";

export function readContainerMutationMetadataDocumentId(input: {
  response: {
    accessManifest: { state: Record<string, unknown> };
  };
}): string {
  const metadataDocumentId = Reflect.get(
    input.response.accessManifest.state,
    "metadataDocumentId",
  );
  if (
    typeof metadataDocumentId !== "string" ||
    metadataDocumentId.length === 0
  ) {
    throw new Error("Container mutation response is missing metadata state");
  }

  return metadataDocumentId;
}

export function referencedPrincipalHeadsFromContainerMutationResponse(input: {
  response: { referencedPrincipalHeads: readonly unknown[] };
}): ReferencedPrincipalStateResponse[] {
  return input.response.referencedPrincipalHeads.flatMap((head) => {
    if (
      !isReferencedPrincipalStateResponse(head) ||
      !Number.isInteger(head.version) ||
      !Number.isInteger(head.keyEpoch)
    ) {
      return [];
    }

    return [
      {
        principalType: head.principalType,
        principalId: head.principalId,
        version: head.version,
        keyEpoch: head.keyEpoch,
        stateHash: head.stateHash,
        keyFingerprint: head.keyFingerprint,
      },
    ];
  });
}
