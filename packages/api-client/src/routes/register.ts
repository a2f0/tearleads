import type {
  DocumentCreateRequest,
  PublicKeyRequest,
} from "@tearleads/validators/request";
import { isPublicKeyResponse } from "@tearleads/validators/response";
import type { RequestFn } from "../types";

export function postPublicKey(
  request: RequestFn,
  userId: string,
  organizationId: string,
  rootContainerId: string,
  signingPublicKey: Uint8Array,
  encapsulationPublicKey: Uint8Array,
  initialOrganizationPolicy: PublicKeyRequest["initialOrganizationPolicy"],
  initialRootContainer: PublicKeyRequest["initialRootContainer"],
  initialRootMetadataDocument: DocumentCreateRequest,
) {
  return request(
    "/auth/register",
    isPublicKeyResponse,
    "POST",
    JSON.stringify({
      userId,
      organizationId,
      rootContainerId,
      signingPublicKey: Array.from(signingPublicKey),
      encapsulationPublicKey: Array.from(encapsulationPublicKey),
      initialOrganizationPolicy,
      initialRootContainer,
      initialRootMetadataDocument,
    }),
  );
}
