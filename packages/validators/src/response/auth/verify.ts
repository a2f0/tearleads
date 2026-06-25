import { isPlainObject } from "../../isPlainObject";
import { hasBooleanProperty, hasOptionalStringProperty } from "../../util";
import {
  type AccountLifecycleResponse,
  isAccountLifecycleResponse,
} from "../account";

export type VerifyResponse =
  | {
      account: AccountLifecycleResponse;
      authenticated: true;
      organizationId: string;
      token: string;
      userId: string;
    }
  | {
      authenticated: false;
      error?: string;
    };

export function isVerifyResponse(value: unknown): value is VerifyResponse {
  if (
    !isPlainObject(value) ||
    !hasBooleanProperty(value, "authenticated") ||
    !hasOptionalStringProperty(value, "organizationId") ||
    !hasOptionalStringProperty(value, "token") ||
    !hasOptionalStringProperty(value, "userId") ||
    !hasOptionalStringProperty(value, "error")
  ) {
    return false;
  }

  return value.authenticated
    ? typeof value.organizationId === "string" &&
        value.organizationId.length > 0 &&
        typeof value.token === "string" &&
        value.token.length > 0 &&
        typeof value.userId === "string" &&
        value.userId.length > 0 &&
        isAccountLifecycleResponse(Reflect.get(value, "account")) &&
        value.error === undefined
    : value.organizationId === undefined &&
        value.token === undefined &&
        value.userId === undefined &&
        Reflect.get(value, "account") === undefined;
}
