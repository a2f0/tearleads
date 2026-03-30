import { isPlainObject } from "../isPlainObject";
import { hasStringProperty } from "../util";

export interface PublicKeyResponse {
  message: string;
  userId: string;
  challenge: string;
}

export function isPublicKeyResponse(
  value: unknown,
): value is PublicKeyResponse {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "message") &&
    hasStringProperty(value, "userId") &&
    hasStringProperty(value, "challenge")
  );
}
