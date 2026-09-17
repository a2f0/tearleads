import { decryptGroupMetadata, readGroupMetadata } from "@tearleads/crypto";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import {
  buildInitialGroupPolicyRequest as buildGroup,
  groupPolicyNameMismatch as mismatch,
  readGroupPolicyPayloadName as readName,
} from "../../src/workflows/organizations/principalPolicyRequest";

export function testGroupMetadataKey(organizationId = "organization-1") {
  return {
    organizationId,
    containerId: "test-metadata-container",
    containerKeyEpochId: "test-metadata-epoch",
    keyMaterial: new Uint8Array(32).fill(7),
  };
}

export function buildInitialGroupPolicyRequest(
  input: Parameters<typeof buildGroup>[0],
) {
  return buildGroup({
    ...input,
    ...(input.name === "Admins"
      ? { builtinRole: "admins" as const }
      : input.name === "Members"
        ? { builtinRole: "members" as const }
        : {}),
    metadataKey: input.metadataKey ?? testGroupMetadataKey(),
  });
}

export async function readTestGroupName(
  bundle: PrincipalPolicyBundleResponse,
): Promise<string> {
  const metadata = readGroupMetadata(bundle.currentPayload.ciphertext);
  if ("role" in metadata)
    return metadata.role === "admins" ? "Admins" : "Members";
  return decryptGroupMetadata({
    key: { ...metadata, keyMaterial: testGroupMetadataKey().keyMaterial },
    groupId: bundle.currentState.principalId,
    payload: bundle.currentPayload.ciphertext,
  });
}
export const testGroupMetadataAccess = (organizationId: string) => ({
  readName: readTestGroupName,
  loadEncryptionKey: async () => testGroupMetadataKey(organizationId),
});
export const readGroupPolicyPayloadName = (
  bundle: PrincipalPolicyBundleResponse,
) => readName(bundle, readTestGroupName);
export const groupPolicyNameMismatch = (
  bundle: PrincipalPolicyBundleResponse,
  expectedName: string,
) => mismatch(bundle, expectedName, readTestGroupName);
