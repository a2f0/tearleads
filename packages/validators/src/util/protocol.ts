export const SHA256_HEX_LENGTH = 64;
export const AUTH_CHALLENGE_HEX_LENGTH = 64;
export const ML_DSA87_PUBLIC_KEY_BYTES = 2592;
export const ML_DSA87_SIGNATURE_BYTES = 4627;
export const ML_KEM1024_PUBLIC_KEY_BYTES = 1568;

export function isByteArray(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === "number" &&
        Number.isInteger(item) &&
        item >= 0 &&
        item <= 255,
    )
  );
}

export function isByteArrayOfLength(
  value: unknown,
  length: number,
): value is number[] {
  return isByteArray(value) && value.length === length;
}

export function isSha256HexString(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length === SHA256_HEX_LENGTH &&
    /^[0-9a-f]+$/.test(value)
  );
}

export function isAuthChallengeHexString(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length === AUTH_CHALLENGE_HEX_LENGTH &&
    /^[0-9a-f]+$/.test(value)
  );
}
