import { isPlainObject } from "../isPlainObject";
import {
  hasNullableStringProperty,
  hasObjectProperty,
  hasStringProperty,
  isUuidV4String,
} from "../util";
import {
  isPutPrincipalPolicyRequest,
  type PutPrincipalPolicyRequest,
} from "./principal";

export interface CreateOrganizationGroupRequest {
  groupId: string;
  name: string;
  initialGroupPolicy: PutPrincipalPolicyRequest;
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
    isPutPrincipalPolicyRequest(value.initialGroupPolicy)
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
