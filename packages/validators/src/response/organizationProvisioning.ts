import { isPlainObject } from "../isPlainObject";
import { hasNumberProperty, hasStringProperty, isUuidV4String } from "../util";
import {
  type ContainerCreateWithMetadataDocumentResponse,
  isContainerCreateWithMetadataDocumentResponse,
} from "./containerMetadata";
import {
  type DocumentCreateResponse,
  isDocumentCreateResponse,
} from "./documentMutation";

/**
 * The bootstrapped state of a freshly provisioned organization: the ids and
 * signed root metadata the client needs to open the organization locally, plus
 * the optional roster/organization profile artifacts.
 *
 * Shared by user registration (which additionally issues an auth challenge, see
 * {@link RegistrationResponse}) and creating an additional organization for an
 * already-authenticated user ({@link CreateOrganizationResponse}).
 */
export interface OrganizationProvisioningResponse {
  userId: string;
  organizationId: string;
  rootContainerId: string;
  rootMetadataDocumentId: string;
  rootMetadataAccessEpoch: number;
  rootMetadataAccessStateHash: string;
  rootMetadataDocument: DocumentCreateResponse;
  rosterProfileContainer?:
    | ContainerCreateWithMetadataDocumentResponse
    | undefined;
  rosterProfileContainerId?: string | undefined;
  rosterProfileDocument?: DocumentCreateResponse | undefined;
  rosterProfileDocumentId?: string | undefined;
  organizationMetadataContainer?:
    | ContainerCreateWithMetadataDocumentResponse
    | undefined;
  organizationMetadataContainerId?: string | undefined;
  organizationProfileDocument?: DocumentCreateResponse | undefined;
  organizationProfileDocumentId?: string | undefined;
  /** Update ids for metadata seeds committed in the provisioning transaction. */
  committedCoreMetadataUpdateIds: string[];
  /** Update ids for profile seeds committed in the provisioning transaction. */
  committedProfileUpdateIds: string[];
  /**
   * Server-created responses for the additional system containers requested via
   * `initialSystemContainers` (e.g. a trash bin), in request order.
   */
  systemContainers: ContainerCreateWithMetadataDocumentResponse[];
}

function isSystemContainersResponse(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(isContainerCreateWithMetadataDocumentResponse)
  );
}

function isCommittedUpdateIds(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    new Set(value).size === value.length &&
    value.every(
      (updateId) => typeof updateId === "string" && isUuidV4String(updateId),
    )
  );
}

export function isOrganizationProvisioningResponse(
  value: unknown,
): value is OrganizationProvisioningResponse {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "userId") &&
    hasStringProperty(value, "organizationId") &&
    hasStringProperty(value, "rootContainerId") &&
    hasStringProperty(value, "rootMetadataDocumentId") &&
    hasNumberProperty(value, "rootMetadataAccessEpoch") &&
    hasStringProperty(value, "rootMetadataAccessStateHash") &&
    value.rootMetadataAccessStateHash.length > 0 &&
    isDocumentCreateResponse(Reflect.get(value, "rootMetadataDocument")) &&
    (Reflect.get(value, "rosterProfileContainer") === undefined ||
      isContainerCreateWithMetadataDocumentResponse(
        Reflect.get(value, "rosterProfileContainer"),
      )) &&
    (Reflect.get(value, "rosterProfileContainerId") === undefined ||
      hasStringProperty(value, "rosterProfileContainerId")) &&
    (Reflect.get(value, "rosterProfileDocument") === undefined ||
      isDocumentCreateResponse(Reflect.get(value, "rosterProfileDocument"))) &&
    (Reflect.get(value, "rosterProfileDocumentId") === undefined ||
      hasStringProperty(value, "rosterProfileDocumentId")) &&
    (Reflect.get(value, "organizationMetadataContainer") === undefined ||
      isContainerCreateWithMetadataDocumentResponse(
        Reflect.get(value, "organizationMetadataContainer"),
      )) &&
    (Reflect.get(value, "organizationMetadataContainerId") === undefined ||
      hasStringProperty(value, "organizationMetadataContainerId")) &&
    (Reflect.get(value, "organizationProfileDocument") === undefined ||
      isDocumentCreateResponse(
        Reflect.get(value, "organizationProfileDocument"),
      )) &&
    (Reflect.get(value, "organizationProfileDocumentId") === undefined ||
      hasStringProperty(value, "organizationProfileDocumentId")) &&
    isCommittedUpdateIds(
      Reflect.get(value, "committedCoreMetadataUpdateIds"),
    ) &&
    isCommittedUpdateIds(Reflect.get(value, "committedProfileUpdateIds")) &&
    isSystemContainersResponse(Reflect.get(value, "systemContainers"))
  );
}

/**
 * Response to creating an additional organization for the authenticated user.
 * The user is already registered, so unlike registration this carries no auth
 * challenge — it is exactly the shared provisioning result.
 */
export type CreateOrganizationResponse = OrganizationProvisioningResponse;

export function isCreateOrganizationResponse(
  value: unknown,
): value is CreateOrganizationResponse {
  return isOrganizationProvisioningResponse(value);
}
