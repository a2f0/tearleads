import { isPlainObject } from "../isPlainObject";
import {
  hasArrayProperty,
  hasNullableStringProperty,
  hasNumberProperty,
  hasStringProperty,
} from "../util";
import {
  isReferencedPrincipalStateResponse,
  type ReferencedPrincipalStateResponse,
} from "./principal";

export interface CreateContainerResponse {
  id: string;
  organizationId: string;
  parentId: string;
  metadataDocumentId: string;
  metadataAccessEpoch: number;
  metadataRecipientEncapsulationPublicKeys: string[];
  metadataReferencedPrincipals?: ReferencedPrincipalStateResponse[];
}

export interface ShareContainerResponse {
  id: string;
  metadataDocumentId: string;
  metadataAccessEpoch: number;
  metadataRecipientEncapsulationPublicKeys: string[];
  metadataReferencedPrincipals?: ReferencedPrincipalStateResponse[];
}

export type MoveContainerResponse = ContainerSummary;

export interface ContainerSummary {
  id: string;
  organizationId: string;
  parentId: string | null;
  metadataDocumentId: string;
  metadataAccessEpoch: number;
  metadataRecipientEncapsulationPublicKeys: string[];
  metadataReferencedPrincipals?: ReferencedPrincipalStateResponse[];
}

export type ListContainersResponse = ContainerSummary[];

function isContainerSummary(value: unknown): value is ContainerSummary {
  const metadataReferencedPrincipals = isPlainObject(value)
    ? Reflect.get(value, "metadataReferencedPrincipals")
    : undefined;

  return (
    isPlainObject(value) &&
    hasStringProperty(value, "id") &&
    hasStringProperty(value, "organizationId") &&
    hasNullableStringProperty(value, "parentId") &&
    hasStringProperty(value, "metadataDocumentId") &&
    hasNumberProperty(value, "metadataAccessEpoch") &&
    hasArrayProperty(value, "metadataRecipientEncapsulationPublicKeys") &&
    value.metadataRecipientEncapsulationPublicKeys.every(
      (entry) => typeof entry === "string",
    ) &&
    (metadataReferencedPrincipals === undefined ||
      (Array.isArray(metadataReferencedPrincipals) &&
        metadataReferencedPrincipals.every(isReferencedPrincipalStateResponse)))
  );
}

export function isCreateContainerResponse(
  value: unknown,
): value is CreateContainerResponse {
  return isContainerSummary(value) && value.parentId !== null;
}

export function isListContainersResponse(
  value: unknown,
): value is ListContainersResponse {
  return Array.isArray(value) && value.every(isContainerSummary);
}

export function isShareContainerResponse(
  value: unknown,
): value is ShareContainerResponse {
  const metadataReferencedPrincipals = isPlainObject(value)
    ? Reflect.get(value, "metadataReferencedPrincipals")
    : undefined;

  return (
    isPlainObject(value) &&
    hasStringProperty(value, "id") &&
    hasStringProperty(value, "metadataDocumentId") &&
    hasNumberProperty(value, "metadataAccessEpoch") &&
    hasArrayProperty(value, "metadataRecipientEncapsulationPublicKeys") &&
    value.metadataRecipientEncapsulationPublicKeys.every(
      (entry) => typeof entry === "string",
    ) &&
    (metadataReferencedPrincipals === undefined ||
      (Array.isArray(metadataReferencedPrincipals) &&
        metadataReferencedPrincipals.every(isReferencedPrincipalStateResponse)))
  );
}

export function isMoveContainerResponse(
  value: unknown,
): value is MoveContainerResponse {
  return isContainerSummary(value) && value.parentId !== null;
}
