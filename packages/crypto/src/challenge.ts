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

export function authChallengeSigningBytes(input: {
  challengeHex: string;
  fingerprint: string;
}): Uint8Array {
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
      domain: "symcrypt.auth.challenge.v1",
      payload: {
        challenge: input.challengeHex,
        fingerprint: input.fingerprint,
      },
    }),
  );
}
