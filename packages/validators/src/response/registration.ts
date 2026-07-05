import { isPlainObject } from "../isPlainObject";
import { hasStringProperty, isAuthChallengeHexString } from "../util";
import {
  isOrganizationProvisioningResponse,
  type OrganizationProvisioningResponse,
} from "./organizationProvisioning";

export interface RegistrationResponse extends OrganizationProvisioningResponse {
  challenge: string;
}

export function isRegistrationResponse(
  value: unknown,
): value is RegistrationResponse {
  return (
    isOrganizationProvisioningResponse(value) &&
    isPlainObject(value) &&
    hasStringProperty(value, "challenge") &&
    isAuthChallengeHexString(value.challenge)
  );
}
