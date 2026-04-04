import { isPlainObject } from "../isPlainObject";
import { hasStringProperty } from "../util";

export interface EncryptedDocumentUpdate {
  id: string;
  encryptedData: string;
  partialStartVersionVector: string;
  partialEndVersionVector: string;
}

export function isEncryptedDocumentUpdate(
  value: unknown,
): value is EncryptedDocumentUpdate {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "id") &&
    hasStringProperty(value, "encryptedData") &&
    hasStringProperty(value, "partialStartVersionVector") &&
    hasStringProperty(value, "partialEndVersionVector")
  );
}
