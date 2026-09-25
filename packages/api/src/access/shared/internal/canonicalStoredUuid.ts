import { KeyingVerificationError } from "@tearleads/crypto";

// PostgreSQL UUID columns print lowercase dashed UUIDs. Never normalize a
// signed identity: the bytes, not just the UUID value, are authenticated.
export function assertCanonicalStoredUuid(value: string, label: string): void {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      value,
    )
  ) {
    throw new KeyingVerificationError(
      "invalid_shape",
      `${label} must be a canonical UUID`,
    );
  }
}
