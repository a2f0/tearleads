import { isPlainObject } from "../isPlainObject";
import {
  hasArrayProperty,
  hasNullableStringProperty,
  hasObjectProperty,
  hasStringProperty,
  isUuidV4String,
} from "../util";
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

export interface CreateOrganizationGroupRequest {
  groupId: string;
  name: string;
  initialGroupPolicy: {
    state: PrincipalStateRequest;
    encryptedPayload: PrincipalStateEncryptedPayloadRequest;
    projection: PrincipalProjectionMemberRequest[];
    memberEnvelopes: PrincipalMemberEnvelopeRequest[];
  };
}

export interface UpdateOrganizationRosterEntryRequest {
  profileDocumentId: string | null;
}

export interface UpdateOrganizationProfileRequest {
  profileDocumentId: string | null;
}

export function isCreateOrganizationGroupRequest(
  value: unknown,
): value is CreateOrganizationGroupRequest {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "groupId") &&
    isUuidV4String(value.groupId) &&
    hasStringProperty(value, "name") &&
    value.name.trim().length > 0 &&
    hasObjectProperty(value, "initialGroupPolicy") &&
    hasObjectProperty(value.initialGroupPolicy, "state") &&
    isPrincipalStateRequest(value.initialGroupPolicy.state) &&
    hasObjectProperty(value.initialGroupPolicy, "encryptedPayload") &&
    isPrincipalStateEncryptedPayloadRequest(
      value.initialGroupPolicy.encryptedPayload,
    ) &&
    hasArrayProperty(value.initialGroupPolicy, "projection") &&
    value.initialGroupPolicy.projection.every(
      isPrincipalProjectionMemberRequest,
    ) &&
    hasArrayProperty(value.initialGroupPolicy, "memberEnvelopes") &&
    value.initialGroupPolicy.memberEnvelopes.every(
      isPrincipalMemberEnvelopeRequest,
    )
  );
}

export function isUpdateOrganizationRosterEntryRequest(
  value: unknown,
): value is UpdateOrganizationRosterEntryRequest {
  return (
    isPlainObject(value) &&
    hasNullableStringProperty(value, "profileDocumentId") &&
    (value.profileDocumentId === null ||
      isUuidV4String(value.profileDocumentId))
  );
}

export function isUpdateOrganizationProfileRequest(
  value: unknown,
): value is UpdateOrganizationProfileRequest {
  return (
    isPlainObject(value) &&
    hasNullableStringProperty(value, "profileDocumentId") &&
    (value.profileDocumentId === null ||
      isUuidV4String(value.profileDocumentId))
  );
}
