import { isPlainObject } from "../isPlainObject";
import {
  hasArrayProperty,
  hasNullableStringProperty,
  hasNumberProperty,
  hasStringProperty,
} from "../util";

export interface CreateContainerResponse {
  id: string;
  organizationId: string;
  parentId: string;
  metadataDocumentId: string;
  metadataAccessEpoch: number;
  metadataRecipientEncapsulationPublicKeys: string[];
}

export interface ContainerSummary {
  id: string;
  organizationId: string;
  parentId: string | null;
  metadataDocumentId: string;
  metadataAccessEpoch: number;
  metadataRecipientEncapsulationPublicKeys: string[];
}

export type ListContainersResponse = ContainerSummary[];

function isContainerSummary(value: unknown): value is ContainerSummary {
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
    )
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
