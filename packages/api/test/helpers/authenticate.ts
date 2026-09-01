import type { TestUser } from "@tearleads/bob-and-alice";
import { authChallengeSigningBytes, sign } from "@tearleads/crypto";
import invariant from "invariant";
import { requestChallenge, submitVerify } from "./api";

async function authenticateWithChallenge(
  user: TestUser,
  challengeHex: string,
): Promise<void> {
  const signature = sign(
    authChallengeSigningBytes({
      challengeHex,
      fingerprint: user.fingerprint,
    }),
    user.signing.signingPrivateKey,
  );
  const res = await submitVerify(user.fingerprint, signature);
  if (res.status !== 200) {
    throw new Error(`submitVerify failed with status ${res.status}`);
  }

  const body = await res.json();
  invariant(typeof body.token === "string", "expected token string");
  user.token = body.token;
}

export async function authenticate(user: TestUser): Promise<void> {
  const challengeRes = await requestChallenge(user.fingerprint);
  if (challengeRes.status !== 200) {
    throw new Error(
      `requestChallenge failed with status ${challengeRes.status}`,
    );
  }

  const { challenge } = await challengeRes.json();
  invariant(typeof challenge === "string", "expected challenge string");

  await authenticateWithChallenge(user, challenge);
}
