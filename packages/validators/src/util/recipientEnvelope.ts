import { isPlainObject } from "../isPlainObject";
import { hasStringProperty } from "./properties";

export interface SerializedRecipientEnvelope {
  keyFingerprint: string;
  kemCipherText: string;
  wrappedKey: string;
}

export function isSerializedRecipientEnvelope(
  value: unknown,
): value is SerializedRecipientEnvelope {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "keyFingerprint") &&
    hasStringProperty(value, "kemCipherText") &&
    hasStringProperty(value, "wrappedKey")
  );
}

export function isSerializedRecipientEnvelopeArray(
  value: unknown,
): value is SerializedRecipientEnvelope[] {
  return Array.isArray(value) && value.every(isSerializedRecipientEnvelope);
}
