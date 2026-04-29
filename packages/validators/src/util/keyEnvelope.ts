import { isPlainObject } from "../isPlainObject";
import { hasStringProperty } from "./properties";

export interface SerializedKeyEnvelope {
  keyFingerprint: string;
  kemCipherText: string;
  wrappedKey: string;
}

export function isSerializedKeyEnvelope(
  value: unknown,
): value is SerializedKeyEnvelope {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "keyFingerprint") &&
    hasStringProperty(value, "kemCipherText") &&
    hasStringProperty(value, "wrappedKey")
  );
}

export function isSerializedKeyEnvelopeArray(
  value: unknown,
): value is SerializedKeyEnvelope[] {
  return Array.isArray(value) && value.every(isSerializedKeyEnvelope);
}
