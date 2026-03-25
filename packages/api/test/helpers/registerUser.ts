import { toFingerprint } from "@tearleads/crypto";
import { isChallengeResponse } from "@tearleads/validators/response";
import invariant from "invariant";
import { uploadKey } from "./api";
import type { TestUser } from "./createTestUser";

export async function registerUser(user: TestUser): Promise<string> {
  user.fingerprint = await toFingerprint(user.signing.signingPublicKey);

  const res = await uploadKey(
    user.signing.signingPublicKey,
    user.kem.publicKey,
  );
  if (res.status !== 200) {
    throw new Error(`uploadKey failed with status ${res.status}`);
  }

  const body = await res.json();
  user.userId = body.userId;

  invariant(
    isChallengeResponse(body),
    "expected challenge in register response",
  );
  return body.challenge;
}
