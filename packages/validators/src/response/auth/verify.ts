import { isPlainObject } from "../../isPlainObject";
import { hasBooleanProperty, hasOptionalStringProperty } from "../../util";

export interface VerifyResponse {
  authenticated: boolean;
  token?: string;
  error?: string;
}

export function isVerifyResponse(value: unknown): value is VerifyResponse {
  if (
    !isPlainObject(value) ||
    !hasBooleanProperty(value, "authenticated") ||
    !hasOptionalStringProperty(value, "token") ||
    !hasOptionalStringProperty(value, "error")
  ) {
    return false;
  }

  return value.authenticated
    ? typeof value.token === "string" &&
        value.token.length > 0 &&
        value.error === undefined
    : value.token === undefined;
}
