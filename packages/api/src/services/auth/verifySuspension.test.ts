import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { users } from "@tearleads/api-shared/schema";
import {
  authChallengeSigningBytes,
  sign,
  toFingerprint,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { createTestUser } from "@tearleads/test-utils";
import { eq } from "drizzle-orm";
import {
  createRegistrationRequest,
  createServiceTestRuntime,
} from "../../../test/helpers/serviceRuntime";
import { createChallenge } from "./createChallenge";
import { registerUser } from "./registration";
import { VerifyChallengeError, verifyChallenge } from "./verifyChallenge";

const API_ORIGIN = "https://api.example.test";

async function signedVerifyInput(
  runtime: ReturnType<typeof createServiceTestRuntime>,
) {
  const user = createTestUser();
  const { userId } = await registerUser(
    runtime,
    await createRegistrationRequest(user),
  );
  const fingerprint = await toFingerprint(user.signing.signingPublicKey);
  const { challenge } = await createChallenge(runtime, { fingerprint });
  const signature = sign(
    authChallengeSigningBytes({
      apiOrigin: API_ORIGIN,
      challengeHex: challenge,
      fingerprint,
    }),
    user.signing.signingPrivateKey,
  );
  return {
    input: {
      apiOrigin: API_ORIGIN,
      fingerprint,
      signature: bytesToBase64(signature),
    },
    userId,
  };
}

async function verifyError(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(VerifyChallengeError);
    return error as VerifyChallengeError;
  }
  throw new Error("Expected verifyChallenge to fail");
}

test("a suspended identity's valid signature issues no session", async () => {
  const runtime = createServiceTestRuntime();
  let issued = 0;
  runtime.sessionTokenIssuer.createSession = async () => {
    issued += 1;
    return { sessionId: "unexpected", token: "unexpected" };
  };
  const { input, userId } = await signedVerifyInput(runtime);
  await db
    .update(users)
    .set({ suspendedAt: new Date() })
    .where(eq(users.id, userId));

  const error = await verifyError(verifyChallenge(runtime, input));

  expect(error.reason).toBe("account_suspended");
  expect(issued).toBe(0);
});

test("a suspension that lands while the session is issued revokes it", async () => {
  const runtime = createServiceTestRuntime();
  const { input, userId } = await signedVerifyInput(runtime);
  const revoked: { sessionId: string; userId: string }[] = [];
  // The suspension commits after verify read the identity but before the new
  // session existed, so its sweep could not have found this session.
  runtime.sessionTokenIssuer.createSession = async () => {
    await db
      .update(users)
      .set({ suspendedAt: new Date() })
      .where(eq(users.id, userId));
    return { sessionId: "raced-session", token: "raced-token" };
  };
  runtime.sessionTokenIssuer.revokeSession = async (session) => {
    revoked.push(session);
    return true;
  };

  const error = await verifyError(verifyChallenge(runtime, input));

  expect(error.reason).toBe("account_suspended");
  expect(revoked).toEqual([{ sessionId: "raced-session", userId }]);
});
