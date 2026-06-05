import type {
  ContainerCreateWithMetadataDocumentRequest,
  DocumentCreateRequest,
  RegistrationRequest,
} from "@tearleads/validators/request";
import { isRegistrationResponse } from "@tearleads/validators/response";
import type { RequestFn } from "../types";

export function postRegistration(
  request: RequestFn,
  userId: string,
  organizationId: string,
  rootContainerId: string,
  signingPublicKey: Uint8Array,
  encapsulationPublicKey: Uint8Array,
  initialAdminGroup: RegistrationRequest["initialAdminGroup"],
  initialMemberGroup: RegistrationRequest["initialMemberGroup"],
  initialOrganizationPolicy: RegistrationRequest["initialOrganizationPolicy"],
  initialRootContainer: RegistrationRequest["initialRootContainer"],
  initialRootMetadataDocument: DocumentCreateRequest,
  initialRosterProfileContainer?:
    | ContainerCreateWithMetadataDocumentRequest
    | undefined,
  initialRosterProfileDocument?: DocumentCreateRequest | undefined,
  initialOrganizationProfileDocument?: DocumentCreateRequest | undefined,
) {
  return request(
    "/auth/register",
    isRegistrationResponse,
    "POST",
    JSON.stringify({
      userId,
      organizationId,
      rootContainerId,
      signingPublicKey: Array.from(signingPublicKey),
      encapsulationPublicKey: Array.from(encapsulationPublicKey),
      initialAdminGroup,
      initialMemberGroup,
      initialOrganizationPolicy,
      initialRootContainer,
      initialRootMetadataDocument,
      initialRosterProfileContainer,
      initialRosterProfileDocument,
      initialOrganizationProfileDocument,
    }),
  );
}
