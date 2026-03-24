import { hexToBytes, sign } from "@tearleads/crypto";
import { postChallenge } from "./challenge";
import { postVerify } from "./verify";

export async function authenticate(
  fingerprint: string,
  secretKey: Uint8Array,
): Promise<boolean> {
  const { challenge } = await postChallenge(fingerprint);
  const challengeBytes = hexToBytes(challenge);
  const signature = sign(challengeBytes, secretKey);
  const result = await postVerify(fingerprint, signature);
  return result.authenticated;
}
