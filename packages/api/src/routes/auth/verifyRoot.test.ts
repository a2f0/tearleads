import { beforeAll, expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { users } from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import { authChallengeSigningBytes, sign } from "@tearleads/crypto";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { requestChallenge, submitVerify } from "../../../test/helpers/api";
import { registerUser } from "../../../test/helpers/registerUser";

const user = createTestUser();

async function verifyAndReadIsRoot(): Promise<boolean> {
  const challengeRes = await requestChallenge(user.fingerprint);
  const { challenge } = await challengeRes.json();
  invariant(typeof challenge === "string", "expected challenge string");
  const signature = sign(
    authChallengeSigningBytes({
      challengeHex: challenge,
      fingerprint: user.fingerprint,
    }),
    user.signing.signingPrivateKey,
  );
  const res = await submitVerify(user.fingerprint, signature);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.authenticated).toBe(true);
  expect(typeof body.isRoot).toBe("boolean");
  return body.isRoot;
}

async function setRoot(isRoot: boolean): Promise<void> {
  await db.update(users).set({ isRoot }).where(eq(users.id, user.userId));
}

beforeAll(async () => {
  await registerUser(user);
});

test("verify reports an ordinary identity as not root", async () => {
  await expect(verifyAndReadIsRoot()).resolves.toBe(false);
});

test("verify reports a promoted identity as root", async () => {
  await setRoot(true);
  await expect(verifyAndReadIsRoot()).resolves.toBe(true);
});

test("verify reports a demoted identity as not root again", async () => {
  await setRoot(false);
  await expect(verifyAndReadIsRoot()).resolves.toBe(false);
});
