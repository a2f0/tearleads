import {
  hasArrayProperty,
  hasNullableNumberProperty,
  hasNumberProperty,
  hasStringProperty,
} from "@tearleads/validators/util";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface AppendDocumentUpdateRequest {
  encryptedData: string;
}

export interface CreateDocumentResponse {
  id: string;
  createdAt: string;
}

export interface DocumentUpdate {
  id: string;
  documentId: string;
  sequence: number;
  authorFingerprint: string;
  encryptedData: string;
  createdAt: string;
}

export interface AppendDocumentUpdateResponse {
  id: string;
  sequence: number;
  createdAt: string;
}

export interface GetDocumentUpdatesResponse {
  documentId: string;
  updates: DocumentUpdate[];
  nextCursor: number | null;
}

export function isAppendDocumentUpdateRequest(
  value: unknown,
): value is AppendDocumentUpdateRequest {
  return isPlainObject(value) && hasStringProperty(value, "encryptedData");
}

export function isCreateDocumentResponse(
  value: unknown,
): value is CreateDocumentResponse {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "id") &&
    hasStringProperty(value, "createdAt")
  );
}

export function isDocumentUpdate(value: unknown): value is DocumentUpdate {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "id") &&
    hasStringProperty(value, "documentId") &&
    hasNumberProperty(value, "sequence") &&
    hasStringProperty(value, "authorFingerprint") &&
    hasStringProperty(value, "encryptedData") &&
    hasStringProperty(value, "createdAt")
  );
}

export function isAppendDocumentUpdateResponse(
  value: unknown,
): value is AppendDocumentUpdateResponse {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "id") &&
    hasNumberProperty(value, "sequence") &&
    hasStringProperty(value, "createdAt")
  );
}

export function isGetDocumentUpdatesResponse(
  value: unknown,
): value is GetDocumentUpdatesResponse {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "documentId") &&
    hasArrayProperty(value, "updates") &&
    value.updates.every(isDocumentUpdate) &&
    hasNullableNumberProperty(value, "nextCursor")
  );
}
