import {
  hasArrayProperty,
  hasNumberProperty,
  hasStringProperty,
} from "@tearleads/validators/util";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface SyncDocumentOutgoingUpdate {
  id: string;
  encryptedData: string;
  partialStartVersionVector: string;
  partialEndVersionVector: string;
}

export interface CreateDocumentResponse {
  id: string;
  createdAt: string;
  currentAccessEpoch: number;
}

export interface SyncDocumentRequest {
  accessEpoch: number;
  localVersionVector: string | null;
  outgoingUpdates: SyncDocumentOutgoingUpdate[];
}

export interface DocumentSyncUpdate {
  id: string;
  documentId: string;
  authorFingerprint: string;
  encryptedData: string;
  partialStartVersionVector: string;
  partialEndVersionVector: string;
  createdAt: string;
}

export interface SyncDocumentResponse {
  documentId: string;
  acceptedOutgoingUpdateIds: string[];
  updates: DocumentSyncUpdate[];
  currentAccessEpoch: number;
}

function hasPositiveNumberProperty<Key extends string>(
  value: Record<string, unknown>,
  key: Key,
): value is Record<string, unknown> & Record<Key, number> {
  return (
    hasNumberProperty(value, key) &&
    Number.isInteger(value[key]) &&
    value[key] > 0
  );
}

function hasNullableStringProperty<Key extends string>(
  value: Record<string, unknown>,
  key: Key,
): value is Record<string, unknown> & Record<Key, string | null> {
  return value[key] === null || typeof value[key] === "string";
}

export function isSyncDocumentOutgoingUpdate(
  value: unknown,
): value is SyncDocumentOutgoingUpdate {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "id") &&
    hasStringProperty(value, "encryptedData") &&
    hasStringProperty(value, "partialStartVersionVector") &&
    hasStringProperty(value, "partialEndVersionVector")
  );
}

export function isCreateDocumentResponse(
  value: unknown,
): value is CreateDocumentResponse {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "id") &&
    hasStringProperty(value, "createdAt") &&
    hasPositiveNumberProperty(value, "currentAccessEpoch")
  );
}

export function isSyncDocumentRequest(
  value: unknown,
): value is SyncDocumentRequest {
  return (
    isPlainObject(value) &&
    hasPositiveNumberProperty(value, "accessEpoch") &&
    hasNullableStringProperty(value, "localVersionVector") &&
    hasArrayProperty(value, "outgoingUpdates") &&
    value.outgoingUpdates.every(isSyncDocumentOutgoingUpdate)
  );
}

export function isDocumentSyncUpdate(
  value: unknown,
): value is DocumentSyncUpdate {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "id") &&
    hasStringProperty(value, "documentId") &&
    hasStringProperty(value, "authorFingerprint") &&
    hasStringProperty(value, "encryptedData") &&
    hasStringProperty(value, "partialStartVersionVector") &&
    hasStringProperty(value, "partialEndVersionVector") &&
    hasStringProperty(value, "createdAt")
  );
}

export function isSyncDocumentResponse(
  value: unknown,
): value is SyncDocumentResponse {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "documentId") &&
    hasArrayProperty(value, "acceptedOutgoingUpdateIds") &&
    value.acceptedOutgoingUpdateIds.every(
      (entry) => typeof entry === "string",
    ) &&
    hasArrayProperty(value, "updates") &&
    value.updates.every(isDocumentSyncUpdate) &&
    hasPositiveNumberProperty(value, "currentAccessEpoch")
  );
}
