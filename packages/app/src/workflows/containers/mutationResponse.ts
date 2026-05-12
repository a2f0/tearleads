import type { ReferencedPrincipalStateResponse } from "@tearleads/validators/response";

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
    if (typeof head !== "object" || head === null) {
      return [];
    }

    const principalType = Reflect.get(head, "principalType");
    const principalId = Reflect.get(head, "principalId");
    const version = Reflect.get(head, "version");
    const keyEpoch = Reflect.get(head, "keyEpoch");
    const stateHash = Reflect.get(head, "stateHash");
    const keyFingerprint = Reflect.get(head, "keyFingerprint");

    if (
      (principalType !== "group" && principalType !== "organization") ||
      typeof principalId !== "string" ||
      !Number.isInteger(version) ||
      !Number.isInteger(keyEpoch) ||
      typeof stateHash !== "string" ||
      typeof keyFingerprint !== "string"
    ) {
      return [];
    }

    return [
      {
        principalType,
        principalId,
        version: version as number,
        keyEpoch: keyEpoch as number,
        stateHash,
        keyFingerprint,
      },
    ];
  });
}
