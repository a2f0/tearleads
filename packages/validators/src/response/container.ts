import { isPlainObject } from "../isPlainObject";
import {
  hasArrayProperty,
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

export function isCreateContainerResponse(
  value: unknown,
): value is CreateContainerResponse {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "id") &&
    hasStringProperty(value, "organizationId") &&
    hasStringProperty(value, "parentId") &&
    hasStringProperty(value, "metadataDocumentId") &&
    hasNumberProperty(value, "metadataAccessEpoch") &&
    hasArrayProperty(value, "metadataRecipientEncapsulationPublicKeys") &&
    value.metadataRecipientEncapsulationPublicKeys.every(
      (entry) => typeof entry === "string",
    )
  );
}
