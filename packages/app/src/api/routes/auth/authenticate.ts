import { hexToBytes, sign } from "@tearleads/crypto";
import type { RequestFn } from "../../types";
import { postChallenge } from "./challenge";
import { postVerify } from "./verify";

export async function authenticate(
  request: RequestFn,
  fingerprint: string,
  secretKey: Uint8Array,
): Promise<string | null> {
  const { challenge } = await postChallenge(request, fingerprint);
  return authenticateWithChallenge(request, fingerprint, secretKey, challenge);
}

export async function authenticateWithChallenge(
  request: RequestFn,
  fingerprint: string,
  secretKey: Uint8Array,
  challengeHex: string,
): Promise<string | null> {
  const challengeBytes = hexToBytes(challengeHex);
  const signature = sign(challengeBytes, secretKey);
  const result = await postVerify(request, fingerprint, signature);
  return result.authenticated ? (result.token ?? null) : null;
}
