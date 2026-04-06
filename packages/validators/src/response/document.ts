import { isPlainObject } from "../isPlainObject";
import {
  hasArrayProperty,
  hasNumberProperty,
  hasStringProperty,
} from "../util";

export interface ContainerDocumentSummary {
  createdAt: string;
  currentAccessEpoch: number;
  id: string;
  linkedContainerIds: string[];
  recipientEncapsulationPublicKeys: string[];
}

export type ListContainerDocumentsResponse = ContainerDocumentSummary[];

function isContainerDocumentSummary(
  value: unknown,
): value is ContainerDocumentSummary {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "createdAt") &&
    hasNumberProperty(value, "currentAccessEpoch") &&
    hasStringProperty(value, "id") &&
    hasArrayProperty(value, "linkedContainerIds") &&
    value.linkedContainerIds.every((entry) => typeof entry === "string") &&
    hasArrayProperty(value, "recipientEncapsulationPublicKeys") &&
    value.recipientEncapsulationPublicKeys.every(
      (entry) => typeof entry === "string",
    )
  );
}

export function isListContainerDocumentsResponse(
  value: unknown,
): value is ListContainerDocumentsResponse {
  return Array.isArray(value) && value.every(isContainerDocumentSummary);
}
