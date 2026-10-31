export const SHA256_HEX_LENGTH = 64;
export const AUTH_CHALLENGE_HEX_LENGTH = 64;
export const ML_DSA87_PUBLIC_KEY_BYTES = 2592;
export const ML_DSA87_SIGNATURE_BYTES = 4627;
export const ML_KEM1024_PUBLIC_KEY_BYTES = 1568;

const BASE64_ALPHABET = "[A-Za-z0-9+/]";
// The final character before padding carries 2 (one byte) or 4 (two bytes)
// unused bits; canonical base64 keeps them zero, so each byte string has
// exactly one encoding.
const ONE_BYTE_TAIL = "[AQgw]==";
const TWO_BYTE_TAIL = "[AEIMQUYcgkosw048]=";

export function base64Length(bytes: number): number {
  return Math.ceil(bytes / 3) * 4;
}

/** The pattern of canonical, padded base64 that decodes to `bytes` bytes. */
export function canonicalBase64Pattern(bytes: number): string {
  const groups = Math.floor(bytes / 3);
  const remainder = bytes % 3;
  const head = `(?:${BASE64_ALPHABET}{4}){${groups}}`;
  const tail =
    remainder === 0
      ? ""
      : remainder === 1
        ? `${BASE64_ALPHABET}${ONE_BYTE_TAIL}`
        : `${BASE64_ALPHABET}{2}${TWO_BYTE_TAIL}`;
  return `^${head}${tail}$`;
}

const canonicalBase64Expressions = new Map<number, RegExp>();

export function isCanonicalBase64OfLength(
  value: unknown,
  bytes: number,
): value is string {
  if (typeof value !== "string" || value.length !== base64Length(bytes)) {
    return false;
  }
  let expression = canonicalBase64Expressions.get(bytes);
  if (!expression) {
    expression = new RegExp(canonicalBase64Pattern(bytes), "u");
    canonicalBase64Expressions.set(bytes, expression);
  }
  return expression.test(value);
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
