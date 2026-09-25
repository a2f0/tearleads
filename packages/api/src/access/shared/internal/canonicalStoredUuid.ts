import { KeyingVerificationError } from "@tearleads/crypto";

// PostgreSQL UUID columns print lowercase dashed UUIDs. Never normalize a
// signed identity: the bytes, not just the UUID value, are authenticated.
// Every UUID version has the same storage representation; the round-trip rule
// constrains spelling without imposing a new version policy on existing routes.
export function isCanonicalStoredUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
    value,
  );
}

export function assertCanonicalStoredUuid(value: string, label: string): void {
  if (!isCanonicalStoredUuid(value)) {
    throw new KeyingVerificationError(
      "invalid_shape",
      `${label} must be a canonical UUID`,
    );
  }
}
