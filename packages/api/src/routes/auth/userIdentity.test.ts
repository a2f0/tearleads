import { afterAll, expect, test } from "bun:test";
import {
  authChallengeSigningBytes,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  sign,
  toFingerprint,
} from "@tearleads/crypto";
import invariant from "invariant";
import {
  fetchUserIdentity,
  requestChallenge,
  submitRegistration,
  submitVerify,
} from "../../../test/helpers/api";
import { del } from "../../adapters/redis";

const signingKeys = generateSigningSeedAndKeyPair();
const kemKeys = generateKemSeedAndKeyPair();
let fingerprint: string;
let userId: string;

afterAll(async () => {
  await del(fingerprint);
});

async function authenticate(): Promise<string> {
  const challengeRes = await requestChallenge(fingerprint);
  const { challenge } = await challengeRes.json();
  invariant(typeof challenge === "string", "expected challenge string");

  const signature = sign(
    authChallengeSigningBytes({ challengeHex: challenge, fingerprint }),
    signingKeys.signingPrivateKey,
  );
  const res = await submitVerify(fingerprint, signature);
  const body = await res.json();
  invariant(typeof body.token === "string", "expected token string");
  return body.token;
}

test("setup: register user", async () => {
  fingerprint = await toFingerprint(signingKeys.signingPublicKey);
  const res = await submitRegistration(
    signingKeys.signingPublicKey,
    signingKeys.signingPrivateKey,
    kemKeys.publicKey,
  );
  const body = await res.json();
  invariant(typeof body.userId === "string", "expected userId string");
  userId = body.userId;
});

test("returns 401 without a token", async () => {
  const res = await fetchUserIdentity(userId, "");
  expect(res.status).toBe(401);
});

test("returns the complete identity for a valid user", async () => {
  const token = await authenticate();

  const res = await fetchUserIdentity(userId, token);
  expect(res.status).toBe(200);

  const body = await res.json();
  expect(body.userId).toBe(userId);
  expect(typeof body.signingPublicKey).toBe("string");
  expect(body.signingKeyFingerprint).toBe(fingerprint);
  expect(typeof body.encapsulationPublicKey).toBe("string");
  expect(body.encapsulationPublicKey.length).toBeGreaterThan(0);
  expect(body.encapsulationKeyFingerprint).toBe(
    await toFingerprint(kemKeys.publicKey),
  );
});

test("returns 404 for a non-existent user", async () => {
  const token = await authenticate();

  const res = await fetchUserIdentity(
    "00000000-0000-0000-0000-000000000000",
    token,
  );
  expect(res.status).toBe(404);
  const body = await res.json();
  expect(body.error).toBe("User not found");
});
