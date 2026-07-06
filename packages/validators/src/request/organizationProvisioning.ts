import { isPlainObject } from "../isPlainObject";
import {
  hasArrayProperty,
  hasObjectProperty,
  hasStringProperty,
  isUuidV4String,
} from "../util";
import {
  type ContainerMutationRequest,
  isContainerMutationRequest,
} from "./container";
import {
  type ContainerCreateWithMetadataDocumentRequest,
  isContainerCreateWithMetadataDocumentRequest,
} from "./containerMetadata";
import {
  type DocumentCreateRequest,
  isDocumentCreateRequest,
} from "./document";
import {
  type CreateOrganizationGroupRequest,
  isCreateOrganizationGroupRequest,
} from "./organization";
import {
  isPrincipalMemberEnvelopeRequest,
  isPrincipalProjectionMemberRequest,
  isPrincipalStateEncryptedPayloadRequest,
  isPrincipalStateRequest,
  type PrincipalMemberEnvelopeRequest,
  type PrincipalProjectionMemberRequest,
  type PrincipalStateEncryptedPayloadRequest,
  type PrincipalStateRequest,
} from "./principal";

/**
 * The client-signed artifacts required to bootstrap a fresh organization: the
 * organization + admin/member group policies, the signed root container and its
 * metadata document, and the optional roster/organization profile documents.
 *
 * This is the shared shape between user registration (which bootstraps the
 * user's personal organization) and creating an additional organization for an
 * existing user. Registration additionally carries the new user's public key
 * material (see {@link RegistrationRequest}); creating an additional
 * organization reuses the caller's existing keys, so it needs only this base.
 */
export interface OrganizationProvisioningRequest {
  userId: string;
  organizationId: string;
  rootContainerId: string;
  initialAdminGroup: CreateOrganizationGroupRequest;
  initialMemberGroup: CreateOrganizationGroupRequest;
  initialOrganizationPolicy: {
    state: PrincipalStateRequest;
    encryptedPayload: PrincipalStateEncryptedPayloadRequest;
    projection: PrincipalProjectionMemberRequest[];
    memberEnvelopes: PrincipalMemberEnvelopeRequest[];
  };
  initialRootContainer: ContainerMutationRequest;
  initialRootMetadataDocument: DocumentCreateRequest;
  initialRosterProfileContainer?:
    | ContainerCreateWithMetadataDocumentRequest
    | undefined;
  initialRosterProfileDocument?: DocumentCreateRequest | undefined;
  /**
   * Dedicated container for org-wide public metadata, born with a read grant to
   * the reserved Members group so every active roster member can decrypt it.
   * The organization profile document (holding the display name) is linked here
   * rather than into the Admins-scoped roster profile container, which also
   * carries the founder's private roster PII.
   */
  initialOrganizationMetadataContainer?:
    | ContainerCreateWithMetadataDocumentRequest
    | undefined;
  initialOrganizationProfileDocument?: DocumentCreateRequest | undefined;
}

export function isOrganizationProvisioningRequest(
  value: unknown,
): value is OrganizationProvisioningRequest {
  const initialRootContainer = isPlainObject(value)
    ? Reflect.get(value, "initialRootContainer")
    : undefined;
  const initialRootMetadataDocument = isPlainObject(value)
    ? Reflect.get(value, "initialRootMetadataDocument")
    : undefined;
  const initialRosterProfileDocument = isPlainObject(value)
    ? Reflect.get(value, "initialRosterProfileDocument")
    : undefined;
  const initialOrganizationProfileDocument = isPlainObject(value)
    ? Reflect.get(value, "initialOrganizationProfileDocument")
    : undefined;
  const initialRosterProfileContainer = isPlainObject(value)
    ? Reflect.get(value, "initialRosterProfileContainer")
    : undefined;
  const initialOrganizationMetadataContainer = isPlainObject(value)
    ? Reflect.get(value, "initialOrganizationMetadataContainer")
    : undefined;

  return (
    isPlainObject(value) &&
    hasStringProperty(value, "userId") &&
    isUuidV4String(value.userId) &&
    hasStringProperty(value, "organizationId") &&
    isUuidV4String(value.organizationId) &&
    hasStringProperty(value, "rootContainerId") &&
    isUuidV4String(value.rootContainerId) &&
    hasObjectProperty(value, "initialAdminGroup") &&
    isCreateOrganizationGroupRequest(value.initialAdminGroup) &&
    hasObjectProperty(value, "initialMemberGroup") &&
    isCreateOrganizationGroupRequest(value.initialMemberGroup) &&
    hasObjectProperty(value, "initialOrganizationPolicy") &&
    hasObjectProperty(value.initialOrganizationPolicy, "state") &&
    isPrincipalStateRequest(value.initialOrganizationPolicy.state) &&
    hasObjectProperty(value.initialOrganizationPolicy, "encryptedPayload") &&
    isPrincipalStateEncryptedPayloadRequest(
      value.initialOrganizationPolicy.encryptedPayload,
    ) &&
    hasArrayProperty(value.initialOrganizationPolicy, "projection") &&
    value.initialOrganizationPolicy.projection.every(
      isPrincipalProjectionMemberRequest,
    ) &&
    hasArrayProperty(value.initialOrganizationPolicy, "memberEnvelopes") &&
    value.initialOrganizationPolicy.memberEnvelopes.every(
      isPrincipalMemberEnvelopeRequest,
    ) &&
    isContainerMutationRequest(initialRootContainer) &&
    isDocumentCreateRequest(initialRootMetadataDocument) &&
    (initialRosterProfileContainer === undefined ||
      isContainerCreateWithMetadataDocumentRequest(
        initialRosterProfileContainer,
      )) &&
    (initialRosterProfileDocument === undefined ||
      isDocumentCreateRequest(initialRosterProfileDocument)) &&
    (initialOrganizationMetadataContainer === undefined ||
      isContainerCreateWithMetadataDocumentRequest(
        initialOrganizationMetadataContainer,
      )) &&
    (initialOrganizationProfileDocument === undefined ||
      isDocumentCreateRequest(initialOrganizationProfileDocument))
  );
}

/**
 * Request to create an additional organization for the authenticated user. The
 * caller re-signs the same provisioning artifacts as registration, but with
 * their existing identity keys, so the request is exactly an
 * {@link OrganizationProvisioningRequest} where `userId` is the caller.
 */
export type CreateOrganizationRequest = OrganizationProvisioningRequest;

export function isCreateOrganizationRequest(
  value: unknown,
): value is CreateOrganizationRequest {
  return isOrganizationProvisioningRequest(value);
}
