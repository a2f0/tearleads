import { randomBytes } from "@noble/post-quantum/utils.js";

export const CHALLENGE_TTL_SECONDS = 60;

export function generateChallenge(length = 32): Uint8Array {
  return randomBytes(length);
}
