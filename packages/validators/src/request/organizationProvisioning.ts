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
  type DocumentSyncRequest,
  isDocumentCreateRequest,
  isDocumentSyncRequest,
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
 * A built-in or app-owned system container whose encrypted initial metadata
 * body is committed in the same transaction as the organization and document
 * shell.
 */
export interface ProvisionedSystemContainerRequest
  extends ContainerCreateWithMetadataDocumentRequest {
  initialMetadataSync: DocumentSyncRequest;
}

/**
 * A document whose encrypted initial body is committed with its manifest in the
 * organization-provisioning transaction.
 */
export interface ProvisionedDocumentRequest extends DocumentCreateRequest {
  initialSync: DocumentSyncRequest;
}

export function isProvisionedDocumentRequest(
  value: unknown,
): value is ProvisionedDocumentRequest {
  const initialSync = isPlainObject(value)
    ? Reflect.get(value, "initialSync")
    : undefined;

  return (
    isDocumentCreateRequest(value) &&
    isDocumentSyncRequest(initialSync) &&
    initialSync.outgoingUpdates.length === 1 &&
    (initialSync.containerRekeys?.length ?? 0) === 0
  );
}

function isDocumentProvisioningRequest(
  value: unknown,
): value is DocumentCreateRequest | ProvisionedDocumentRequest {
  if (!isDocumentCreateRequest(value)) {
    return false;
  }

  const initialSync = Reflect.get(value, "initialSync");
  return initialSync === undefined || isProvisionedDocumentRequest(value);
}

export function isProvisionedSystemContainerRequest(
  value: unknown,
): value is ProvisionedSystemContainerRequest {
  const initialMetadataSync = isPlainObject(value)
    ? Reflect.get(value, "initialMetadataSync")
    : undefined;

  return (
    isContainerCreateWithMetadataDocumentRequest(value) &&
    isDocumentSyncRequest(initialMetadataSync) &&
    initialMetadataSync.outgoingUpdates.length === 1 &&
    (initialMetadataSync.containerRekeys?.length ?? 0) === 0
  );
}

function isSystemContainerProvisioningRequest(
  value: unknown,
): value is
  | ContainerCreateWithMetadataDocumentRequest
  | ProvisionedSystemContainerRequest {
  if (!isContainerCreateWithMetadataDocumentRequest(value)) {
    return false;
  }

  const initialMetadataSync = Reflect.get(value, "initialMetadataSync");
  return (
    initialMetadataSync === undefined ||
    isProvisionedSystemContainerRequest(value)
  );
}

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
  initialRootMetadataDocument:
    | DocumentCreateRequest
    | ProvisionedDocumentRequest;
  initialRosterProfileContainer?:
    | ContainerCreateWithMetadataDocumentRequest
    | ProvisionedSystemContainerRequest
    | undefined;
  initialRosterProfileDocument?:
    | DocumentCreateRequest
    | ProvisionedDocumentRequest
    | undefined;
  /**
   * Dedicated container for org-wide public metadata, born with a read grant to
   * the reserved Members group so every active roster member can decrypt it.
   * The organization profile document (holding the display name) is linked here
   * rather than into the Admins-scoped roster profile container, which also
   * carries the founder's private roster PII.
   */
  initialOrganizationMetadataContainer?:
    | ContainerCreateWithMetadataDocumentRequest
    | ProvisionedSystemContainerRequest
    | undefined;
  initialOrganizationProfileDocument?:
    | DocumentCreateRequest
    | ProvisionedDocumentRequest
    | undefined;
  /**
   * Additional app-owned system containers to provision atomically with the
   * organization (e.g. a trash bin). Each is a child of the root born
   * Admins-scoped and carries only its metadata document — no separate profile
   * document. Their system slots are derived from the founder's signing key, so
   * they are opaque to the server and unique per organization.
   */
  initialSystemContainers?: ProvisionedSystemContainerRequest[] | undefined;
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
  const initialSystemContainers = isPlainObject(value)
    ? Reflect.get(value, "initialSystemContainers")
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
    isDocumentProvisioningRequest(initialRootMetadataDocument) &&
    (initialRosterProfileContainer === undefined ||
      isSystemContainerProvisioningRequest(initialRosterProfileContainer)) &&
    (initialRosterProfileDocument === undefined ||
      isDocumentProvisioningRequest(initialRosterProfileDocument)) &&
    (initialOrganizationMetadataContainer === undefined ||
      isSystemContainerProvisioningRequest(
        initialOrganizationMetadataContainer,
      )) &&
    (initialOrganizationProfileDocument === undefined ||
      isDocumentProvisioningRequest(initialOrganizationProfileDocument)) &&
    (initialSystemContainers === undefined ||
      (Array.isArray(initialSystemContainers) &&
        initialSystemContainers.every(isProvisionedSystemContainerRequest)))
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
