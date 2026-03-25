import { hexToBytes, sign } from "@tearleads/crypto";
import { postChallenge } from "./challenge";
import { postVerify } from "./verify";

export async function authenticate(
  fingerprint: string,
  secretKey: Uint8Array,
): Promise<string | null> {
  const { challenge } = await postChallenge(fingerprint);
  return authenticateWithChallenge(fingerprint, secretKey, challenge);
}

export async function authenticateWithChallenge(
  fingerprint: string,
  secretKey: Uint8Array,
  challengeHex: string,
): Promise<string | null> {
  const challengeBytes = hexToBytes(challengeHex);
  const signature = sign(challengeBytes, secretKey);
  const result = await postVerify(fingerprint, signature);
  return result.authenticated ? (result.token ?? null) : null;
}
