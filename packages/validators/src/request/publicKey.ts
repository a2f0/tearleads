import { isNumberArray } from "../isNumberArray";
import { isPlainObject } from "../isPlainObject";
import {
  hasArrayProperty,
  hasObjectProperty,
  hasStringProperty,
} from "../util";
import {
  type EncryptedDocumentUpdate,
  isEncryptedDocumentUpdate,
} from "./documentUpdate";

export interface WrappedDekEnvelope {
  keyFingerprint: string;
  kemCipherText: number[];
  wrappedKey: number[];
}

export interface PublicKeyRequest {
  rootContainerId: string;
  signingPublicKey: number[];
  encapsulationPublicKey: number[];
  wrappedDekEnvelope: WrappedDekEnvelope;
  initialRootMetadataUpdates: EncryptedDocumentUpdate[];
}

function isWrappedDekEnvelope(value: Record<string, unknown>): boolean {
  return (
    hasStringProperty(value, "keyFingerprint") &&
    hasArrayProperty(value, "kemCipherText") &&
    isNumberArray(value.kemCipherText) &&
    hasArrayProperty(value, "wrappedKey") &&
    isNumberArray(value.wrappedKey)
  );
}

export function isPublicKeyRequest(value: unknown): value is PublicKeyRequest {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "rootContainerId") &&
    hasArrayProperty(value, "signingPublicKey") &&
    isNumberArray(value.signingPublicKey) &&
    hasArrayProperty(value, "encapsulationPublicKey") &&
    isNumberArray(value.encapsulationPublicKey) &&
    hasObjectProperty(value, "wrappedDekEnvelope") &&
    isWrappedDekEnvelope(value.wrappedDekEnvelope) &&
    hasArrayProperty(value, "initialRootMetadataUpdates") &&
    value.initialRootMetadataUpdates.every(isEncryptedDocumentUpdate)
  );
}
