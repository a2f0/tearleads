import { isPlainObject } from "../isPlainObject";
import {
  hasArrayProperty,
  hasObjectProperty,
  hasStringProperty,
  isByteArrayOfLength,
  isUuidV4String,
  ML_DSA87_PUBLIC_KEY_BYTES,
  ML_KEM1024_PUBLIC_KEY_BYTES,
} from "../util";
import {
  type ContainerMutationRequest,
  isContainerMutationRequest,
} from "./container";
import {
  type DocumentCreateRequest,
  isDocumentCreateRequest,
} from "./document";
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

export interface PublicKeyRequest {
  userId: string;
  organizationId: string;
  rootContainerId: string;
  signingPublicKey: number[];
  encapsulationPublicKey: number[];
  initialOrganizationPolicy: {
    state: PrincipalStateRequest;
    encryptedPayload: PrincipalStateEncryptedPayloadRequest;
    projection: PrincipalProjectionMemberRequest[];
    memberEnvelopes: PrincipalMemberEnvelopeRequest[];
  };
  initialRootContainer: ContainerMutationRequest;
  initialRootMetadataDocument: DocumentCreateRequest;
}

export function isPublicKeyRequest(value: unknown): value is PublicKeyRequest {
  const initialRootContainer = isPlainObject(value)
    ? Reflect.get(value, "initialRootContainer")
    : undefined;
  const initialRootMetadataDocument = isPlainObject(value)
    ? Reflect.get(value, "initialRootMetadataDocument")
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
    isByteArrayOfLength(value.signingPublicKey, ML_DSA87_PUBLIC_KEY_BYTES) &&
    hasArrayProperty(value, "encapsulationPublicKey") &&
    isByteArrayOfLength(
      value.encapsulationPublicKey,
      ML_KEM1024_PUBLIC_KEY_BYTES,
    ) &&
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
    isContainerMutationRequest(initialRootContainer) &&
    isDocumentCreateRequest(initialRootMetadataDocument)
  );
}
