import { isPlainObject } from "@tearleads/validators/isPlainObject";
import {
  hasArrayProperty,
  hasNullableStringProperty,
  hasNumberProperty,
  hasStringProperty,
  isSha256HexString,
  isUuidV4String,
} from "@tearleads/validators/util";

export interface SessionData {
  id: string;
  userId: string;
  fingerprint: string;
  createdAt: number;
  ipAddresses: string[];
  lastActiveAt: number;
  lastActiveIp: string | null;
}

export interface SessionCreateInput {
  userId: string;
  fingerprint: string;
  createdAt: number;
  ipAddress?: string | null | undefined;
}

export function isSessionId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function isNonNegativeSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export function isSessionData(value: unknown): value is SessionData {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "id") &&
    isSessionId(value.id) &&
    hasStringProperty(value, "userId") &&
    isUuidV4String(value.userId) &&
    hasStringProperty(value, "fingerprint") &&
    isSha256HexString(value.fingerprint) &&
    hasNumberProperty(value, "createdAt") &&
    isNonNegativeSafeInteger(value.createdAt) &&
    hasArrayProperty(value, "ipAddresses") &&
    value.ipAddresses.every(
      (ipAddress) => typeof ipAddress === "string" && ipAddress.length > 0,
    ) &&
    hasNumberProperty(value, "lastActiveAt") &&
    isNonNegativeSafeInteger(value.lastActiveAt) &&
    hasNullableStringProperty(value, "lastActiveIp") &&
    (value.lastActiveIp === null || value.lastActiveIp.length > 0)
  );
}
