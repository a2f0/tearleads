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
import {
  isPrincipalMemberEnvelopeRequest,
  isPrincipalProjectionMemberRequest,
  isPrincipalStateEncryptedPayloadRequest,
  isPrincipalStateRequest,
  type PrincipalMemberEnvelopeRequest,
  type PrincipalProjectionMemberRequest,
  type PrincipalStateEncryptedPayloadRequest,
  type PrincipalStateRequest,
} from "./principal";

export interface WrappedDekEnvelope {
  keyFingerprint: string;
  kemCipherText: number[];
  wrappedKey: number[];
}

export interface PublicKeyRequest {
  userId: string;
  organizationId: string;
  rootContainerId: string;
  signingPublicKey: number[];
  encapsulationPublicKey: number[];
  wrappedDekEnvelope: WrappedDekEnvelope;
  initialOrganizationPolicy: {
    state: PrincipalStateRequest;
    encryptedPayload: PrincipalStateEncryptedPayloadRequest;
    projection: PrincipalProjectionMemberRequest[];
    memberEnvelopes: PrincipalMemberEnvelopeRequest[];
  };
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
    hasStringProperty(value, "userId") &&
    isUuidV4String(value.userId) &&
    hasStringProperty(value, "organizationId") &&
    isUuidV4String(value.organizationId) &&
    hasStringProperty(value, "rootContainerId") &&
    isUuidV4String(value.rootContainerId) &&
    hasArrayProperty(value, "signingPublicKey") &&
    isNumberArray(value.signingPublicKey) &&
    hasArrayProperty(value, "encapsulationPublicKey") &&
    isNumberArray(value.encapsulationPublicKey) &&
    hasObjectProperty(value, "wrappedDekEnvelope") &&
    isWrappedDekEnvelope(value.wrappedDekEnvelope) &&
    hasObjectProperty(value, "initialOrganizationPolicy") &&
    hasObjectProperty(value.initialOrganizationPolicy, "state") &&
    isPrincipalStateRequest(value.initialOrganizationPolicy.state) &&
    hasObjectProperty(value.initialOrganizationPolicy, "encryptedPayload") &&
    isPrincipalStateEncryptedPayloadRequest(
      value.initialOrganizationPolicy.encryptedPayload,
    ) &&
    hasArrayProperty(value.initialOrganizationPolicy, "projection") &&
    value.initialOrganizationPolicy.projection.every(
      isPrincipalProjectionMemberRequest,
    ) &&
    hasArrayProperty(value.initialOrganizationPolicy, "memberEnvelopes") &&
    value.initialOrganizationPolicy.memberEnvelopes.every(
      isPrincipalMemberEnvelopeRequest,
    ) &&
    (initialRootMetadataRecipientEnvelopes === undefined ||
      isSerializedRecipientEnvelopeArray(
        initialRootMetadataRecipientEnvelopes,
      )) &&
    hasArrayProperty(value, "initialRootMetadataUpdates") &&
    value.initialRootMetadataUpdates.every(isEncryptedDocumentUpdate)
  );
}
