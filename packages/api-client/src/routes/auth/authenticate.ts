import { hexToBytes, sign } from "@tearleads/crypto";
import {
  isChallengeResponse,
  isVerifyResponse,
} from "@tearleads/validators/response";
import type { RequestFn } from "../../types";
import { getChallenge } from "./challenge";

export async function authenticate(
  request: RequestFn,
  fingerprint: string,
  secretKey: Uint8Array,
) {
  const challenge = await getChallenge(request, fingerprint);
  if (!isChallengeResponse(challenge)) return null;

  return authenticateWithChallenge(
    request,
    fingerprint,
    secretKey,
    challenge.challenge,
  );
}

export async function authenticateWithChallenge(
  request: RequestFn,
  fingerprint: string,
  secretKey: Uint8Array,
  challengeHex: string,
) {
  const signed = sign(hexToBytes(challengeHex), secretKey);
  const response = await request(
    "/auth/verify",
    isVerifyResponse,
    "POST",
    JSON.stringify({ fingerprint, signature: Array.from(signed) }),
  );

  return response?.authenticated ? (response.token ?? null) : null;
}
