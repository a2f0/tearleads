import { hexToBytes, sign } from "@tearleads/crypto";
import type { RequestFn } from "../../types";
import { postChallenge } from "./challenge";
import { postVerify } from "./verify";

export async function authenticate(
  request: RequestFn,
  fingerprint: string,
  secretKey: Uint8Array,
): Promise<string | null> {
  const challengeResponse = await postChallenge(request, fingerprint);
  if (!challengeResponse) return null;
  return authenticateWithChallenge(
    request,
    fingerprint,
    secretKey,
    challengeResponse.challenge,
  );
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
  if (!result) return null;
  return result.authenticated ? (result.token ?? null) : null;
}
