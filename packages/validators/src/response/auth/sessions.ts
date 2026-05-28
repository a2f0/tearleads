import { isPlainObject } from "../../isPlainObject";
import {
  hasArrayProperty,
  hasBooleanProperty,
  hasNullableStringProperty,
  hasStringProperty,
} from "../../util";

export interface UserSessionResponse {
  id: string;
  createdAt: string;
  ipAddresses: string[];
  isCurrent: boolean;
  lastActiveAt: string;
  lastActiveIp: string | null;
  signingKeyFingerprint: string;
}

export interface ListSessionsResponse {
  sessions: UserSessionResponse[];
}

export interface DestroySessionResponse {
  message: "ok";
}

export function isUserSessionResponse(
  value: unknown,
): value is UserSessionResponse {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "id") &&
    /^[0-9a-f]{64}$/.test(value.id) &&
    hasStringProperty(value, "createdAt") &&
    hasArrayProperty(value, "ipAddresses") &&
    value.ipAddresses.every(
      (ipAddress) => typeof ipAddress === "string" && ipAddress.length > 0,
    ) &&
    hasBooleanProperty(value, "isCurrent") &&
    hasStringProperty(value, "lastActiveAt") &&
    hasNullableStringProperty(value, "lastActiveIp") &&
    (value.lastActiveIp === null || value.lastActiveIp.length > 0) &&
    hasStringProperty(value, "signingKeyFingerprint")
  );
}

export function isListSessionsResponse(
  value: unknown,
): value is ListSessionsResponse {
  return (
    isPlainObject(value) &&
    hasArrayProperty(value, "sessions") &&
    value.sessions.every(isUserSessionResponse)
  );
}

export function isDestroySessionResponse(
  value: unknown,
): value is DestroySessionResponse {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "message") &&
    value.message === "ok"
  );
}
