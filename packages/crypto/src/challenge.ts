import { randomBytes } from "@noble/post-quantum/utils.js";

export function generateChallenge(length = 32): Uint8Array {
  return randomBytes(length);
}
