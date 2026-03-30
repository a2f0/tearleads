import { isPlainObject } from "../../isPlainObject";
import { hasBooleanProperty, hasOptionalStringProperty } from "../../util";

export interface VerifyResponse {
  authenticated: boolean;
  token?: string;
  error?: string;
}

export function isVerifyResponse(value: unknown): value is VerifyResponse {
  return (
    isPlainObject(value) &&
    hasBooleanProperty(value, "authenticated") &&
    hasOptionalStringProperty(value, "token") &&
    hasOptionalStringProperty(value, "error")
  );
}
