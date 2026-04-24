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
  currentAccessStateHash?: string;
  id: string;
  linkedContainerIds: string[];
  recipientEncapsulationPublicKeys: string[];
  referencedPrincipals?: ReferencedPrincipalStateResponse[];
}

export type ListContainerDocumentsResponse = ContainerDocumentSummary[];
export type LinkDocumentToContainerResponse = ContainerDocumentSummary;
export type UnlinkDocumentFromContainerResponse = ContainerDocumentSummary;

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
    (currentAccessStateHash === undefined ||
      typeof currentAccessStateHash === "string") &&
    hasStringProperty(value, "id") &&
    hasArrayProperty(value, "linkedContainerIds") &&
    value.linkedContainerIds.every((entry) => typeof entry === "string") &&
    hasArrayProperty(value, "recipientEncapsulationPublicKeys") &&
    value.recipientEncapsulationPublicKeys.every(
      (entry) => typeof entry === "string",
    ) &&
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

export function isLinkDocumentToContainerResponse(
  value: unknown,
): value is LinkDocumentToContainerResponse {
  return isContainerDocumentSummary(value);
}

export function isUnlinkDocumentFromContainerResponse(
  value: unknown,
): value is UnlinkDocumentFromContainerResponse {
  return isContainerDocumentSummary(value);
}
