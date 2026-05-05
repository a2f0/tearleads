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
import { isSyncWatermark, type SyncWatermark } from "./syncWatermark";

export interface ContainerDocumentSummary {
  createdAt: string;
  currentAccessEpoch: number;
  currentAccessStateHash: string;
  id: string;
  linkedContainerIds: string[];
  referencedPrincipals?: ReferencedPrincipalStateResponse[];
  updatedAt?: string;
}

export interface ContainerDocumentSyncTombstone {
  containerId: string;
  documentId: string;
  updatedAt: string;
}

export interface ListContainerDocumentsResponse {
  hasMore: boolean;
  items: ContainerDocumentSummary[];
  nextWatermark: SyncWatermark | null;
  tombstones: ContainerDocumentSyncTombstone[];
}

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
    hasStringProperty(value, "updatedAt") &&
    (referencedPrincipals === undefined ||
      (Array.isArray(referencedPrincipals) &&
        referencedPrincipals.every(isReferencedPrincipalStateResponse)))
  );
}

function isContainerDocumentSyncTombstone(
  value: unknown,
): value is ContainerDocumentSyncTombstone {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "containerId") &&
    hasStringProperty(value, "documentId") &&
    hasStringProperty(value, "updatedAt")
  );
}

export function isListContainerDocumentsResponse(
  value: unknown,
): value is ListContainerDocumentsResponse {
  const nextWatermark = isPlainObject(value)
    ? Reflect.get(value, "nextWatermark")
    : undefined;

  return (
    isPlainObject(value) &&
    typeof Reflect.get(value, "hasMore") === "boolean" &&
    hasArrayProperty(value, "items") &&
    value.items.every(isContainerDocumentSummary) &&
    (isSyncWatermark(nextWatermark) || nextWatermark === null) &&
    hasArrayProperty(value, "tombstones") &&
    value.tombstones.every(isContainerDocumentSyncTombstone)
  );
}
