import { isPlainObject } from "../isPlainObject";
import {
  hasNullableStringProperty,
  hasNumberProperty,
  hasStringProperty,
} from "../util";

export type AccountStatus =
  | "trialing"
  | "active"
  | "disabled"
  | "deleting"
  | "purged";

export interface AccountLifecycleResponse {
  status: AccountStatus;
  trialEndsAt: string;
  disabledAt: string | null;
  purgeAfter: string | null;
  purgeStartedAt: string | null;
  purgedAt: string | null;
  remoteDataEpoch: number;
}

export function isAccountStatus(value: unknown): value is AccountStatus {
  return (
    value === "trialing" ||
    value === "active" ||
    value === "disabled" ||
    value === "deleting" ||
    value === "purged"
  );
}

export function isAccountLifecycleResponse(
  value: unknown,
): value is AccountLifecycleResponse {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "status") &&
    isAccountStatus(value.status) &&
    hasStringProperty(value, "trialEndsAt") &&
    hasNullableStringProperty(value, "disabledAt") &&
    hasNullableStringProperty(value, "purgeAfter") &&
    hasNullableStringProperty(value, "purgeStartedAt") &&
    hasNullableStringProperty(value, "purgedAt") &&
    hasNumberProperty(value, "remoteDataEpoch") &&
    Number.isInteger(value.remoteDataEpoch) &&
    value.remoteDataEpoch > 0
  );
}
