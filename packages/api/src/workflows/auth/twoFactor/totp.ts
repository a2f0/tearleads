import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const TOTP_PERIOD_SECONDS = 30;
const TOTP_DIGITS = 6;
/** 160 bits, the HMAC-SHA1 block-friendly length RFC 4226 recommends. */
const TOTP_SECRET_BYTES = 20;
/** One step either side of now is accepted, for authenticator clock drift. */
const TOTP_STEP_WINDOW = 1;

/** RFC 4648 base32 without padding, as authenticator apps expect. */
export function encodeBase32(bytes: Uint8Array): string {
  let output = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += BASE32_ALPHABET[(buffer >>> bits) & 31];
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(buffer << (5 - bits)) & 31];
  }
  return output;
}

export function generateTotpSecret(): Uint8Array {
  return new Uint8Array(randomBytes(TOTP_SECRET_BYTES));
}

export function totpStep(nowMs: number): number {
  return Math.floor(nowMs / 1000 / TOTP_PERIOD_SECONDS);
}

/** The RFC 6238 code (HMAC-SHA1, six digits) for one time step. */
export function totpCode(secret: Uint8Array, step: number): string {
  const counter = new Uint8Array(8);
  new DataView(counter.buffer).setBigUint64(0, BigInt(step));
  const digest = createHmac("sha1", secret).update(counter).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const binary =
    (((digest[offset] ?? 0) & 0x7f) << 24) |
    ((digest[offset + 1] ?? 0) << 16) |
    ((digest[offset + 2] ?? 0) << 8) |
    (digest[offset + 3] ?? 0);
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

/** Digits only; spaces and dashes an app shows between groups are dropped. */
export function normalizeTotpCode(raw: string): string | null {
  const digits = raw.replace(/[\s-]/g, "");
  return digits.length === TOTP_DIGITS && /^\d+$/.test(digits) ? digits : null;
}

/**
 * The step within the drift window whose code matches, or null. Steps at or
 * before `lastUsedStep` never match, so an accepted code cannot be replayed.
 */
export function matchTotpStep(input: {
  readonly code: string;
  readonly lastUsedStep: number | null;
  readonly nowMs: number;
  readonly secret: Uint8Array;
}): number | null {
  const current = totpStep(input.nowMs);
  const expected = new TextEncoder().encode(input.code);
  let matched: number | null = null;
  // Every candidate is compared so the time taken does not reveal which one
  // matched.
  for (
    let step = current - TOTP_STEP_WINDOW;
    step <= current + TOTP_STEP_WINDOW;
    step += 1
  ) {
    const candidate = new TextEncoder().encode(totpCode(input.secret, step));
    const equal =
      candidate.length === expected.length &&
      timingSafeEqual(candidate, expected);
    const fresh = input.lastUsedStep === null || step > input.lastUsedStep;
    if (equal && fresh && matched === null) {
      matched = step;
    }
  }
  return matched;
}

/** The `otpauth://` URI an authenticator app imports from a QR code. */
export function totpUri(input: {
  readonly accountName: string;
  readonly issuer: string;
  readonly secret: Uint8Array;
}): string {
  const label = `${encodeURIComponent(input.issuer)}:${encodeURIComponent(input.accountName)}`;
  const parameters = new URLSearchParams({
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    issuer: input.issuer,
    period: String(TOTP_PERIOD_SECONDS),
    secret: encodeBase32(input.secret),
  });
  return `otpauth://totp/${label}?${parameters.toString()}`;
}
