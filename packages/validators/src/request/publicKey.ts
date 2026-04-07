import { isNumberArray } from "../isNumberArray";
import { isPlainObject } from "../isPlainObject";
import {
  hasArrayProperty,
  hasObjectProperty,
  hasStringProperty,
  isSerializedRecipientEnvelopeArray,
  isUuidV4String,
  type SerializedRecipientEnvelope,
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
  initialRootMetadataRecipientEnvelopes?: SerializedRecipientEnvelope[];
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
  const initialRootMetadataRecipientEnvelopes = isPlainObject(value)
    ? Reflect.get(value, "initialRootMetadataRecipientEnvelopes")
    : undefined;

  return (
    isPlainObject(value) &&
    hasStringProperty(value, "rootContainerId") &&
    isUuidV4String(value.rootContainerId) &&
    hasArrayProperty(value, "signingPublicKey") &&
    isNumberArray(value.signingPublicKey) &&
    hasArrayProperty(value, "encapsulationPublicKey") &&
    isNumberArray(value.encapsulationPublicKey) &&
    hasObjectProperty(value, "wrappedDekEnvelope") &&
    isWrappedDekEnvelope(value.wrappedDekEnvelope) &&
    (initialRootMetadataRecipientEnvelopes === undefined ||
      isSerializedRecipientEnvelopeArray(
        initialRootMetadataRecipientEnvelopes,
      )) &&
    hasArrayProperty(value, "initialRootMetadataUpdates") &&
    value.initialRootMetadataUpdates.every(isEncryptedDocumentUpdate)
  );
}
