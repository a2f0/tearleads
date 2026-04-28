import { isPlainObject } from "../isPlainObject";
import {
  hasArrayProperty,
  hasNumberProperty,
  hasStringProperty,
} from "../util";
import {
  isReferencedPrincipalStateResponse,
  type ReferencedPrincipalStateResponse,
} from "./principal";

export interface ContainerDocumentSummary {
  createdAt: string;
  currentAccessEpoch: number;
  currentAccessStateHash: string;
  id: string;
  linkedContainerIds: string[];
  referencedPrincipals?: ReferencedPrincipalStateResponse[];
}

export type ListContainerDocumentsResponse = ContainerDocumentSummary[];

function isContainerDocumentSummary(
  value: unknown,
): value is ContainerDocumentSummary {
  const referencedPrincipals = isPlainObject(value)
    ? Reflect.get(value, "referencedPrincipals")
    : undefined;
  const currentAccessStateHash = isPlainObject(value)
    ? Reflect.get(value, "currentAccessStateHash")
    : undefined;

  return (
    isPlainObject(value) &&
    hasStringProperty(value, "createdAt") &&
    hasNumberProperty(value, "currentAccessEpoch") &&
    typeof currentAccessStateHash === "string" &&
    currentAccessStateHash.length > 0 &&
    hasStringProperty(value, "id") &&
    hasArrayProperty(value, "linkedContainerIds") &&
    value.linkedContainerIds.every((entry) => typeof entry === "string") &&
    (referencedPrincipals === undefined ||
      (Array.isArray(referencedPrincipals) &&
        referencedPrincipals.every(isReferencedPrincipalStateResponse)))
  );
}

export function isListContainerDocumentsResponse(
  value: unknown,
): value is ListContainerDocumentsResponse {
  return Array.isArray(value) && value.every(isContainerDocumentSummary);
}
