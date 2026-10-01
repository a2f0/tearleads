import { randomBytes } from "@noble/post-quantum/utils.js";
import { serializeKeyingCanonicalJson } from "./keying";

const TEXT_ENCODER = new TextEncoder();

export const AUTH_CHALLENGE_BYTES = 32;
export const AUTH_CHALLENGE_HEX_LENGTH = AUTH_CHALLENGE_BYTES * 2;
export const CHALLENGE_TTL_SECONDS = 60;

export function generateChallenge(length = AUTH_CHALLENGE_BYTES): Uint8Array {
  if (!Number.isInteger(length) || length <= 0) {
    throw new Error("Challenge length must be a positive integer");
  }

  return randomBytes(length);
}

/**
 * The canonical `scheme://host[:port]` a login challenge is signed for. Both
 * sides derive it themselves: the client from the API it means to reach, the
 * API from its own public origin, so a challenge relayed from another API was
 * signed for the wrong origin and never verifies (#2365 finding 25).
 */
export function canonicalAuthOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Authentication origin must be an absolute URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Authentication origin must use http or https");
  }
  return url.origin;
}

export function authChallengeSigningBytes(input: {
  apiOrigin: string;
  challengeHex: string;
  fingerprint: string;
}): Uint8Array {
  if (canonicalAuthOrigin(input.apiOrigin) !== input.apiOrigin) {
    throw new Error("Authentication origin must be canonical");
  }
  if (!/^[0-9a-f]{64}$/.test(input.fingerprint)) {
    throw new Error("Authentication fingerprint must be a SHA-256 hex string");
  }
  if (
    typeof input.challengeHex !== "string" ||
    input.challengeHex.length !== AUTH_CHALLENGE_HEX_LENGTH ||
    !/^[0-9a-f]+$/.test(input.challengeHex)
  ) {
    throw new Error("Authentication challenge must be canonical hex");
  }

  return TEXT_ENCODER.encode(
    serializeKeyingCanonicalJson({
      domain: "tearleads.auth.challenge.v2",
      payload: {
        apiOrigin: input.apiOrigin,
        challenge: input.challengeHex,
        fingerprint: input.fingerprint,
      },
    }),
  );
}
