import { afterAll, expect, test } from "bun:test";
import {
  generateSeedAndKeyPair,
  hexToBytes,
  sign,
  toFingerprint,
} from "@tearleads/crypto";
import invariant from "invariant";
import {
  fetchEncapsulationKey,
  requestChallenge,
  submitVerify,
  uploadKey,
} from "../../../test/helpers/api";
import { del } from "../../adapters/redis";

const keys = generateSeedAndKeyPair();
let fingerprint: string;
let userId: string;

afterAll(async () => {
  await del(fingerprint);
});

async function authenticate(): Promise<string> {
  const challengeRes = await requestChallenge(fingerprint);
  const { challenge } = await challengeRes.json();
  invariant(typeof challenge === "string", "expected challenge string");

  const signature = sign(hexToBytes(challenge), keys.secretKey);
  const res = await submitVerify(fingerprint, signature);
  const body = await res.json();
  invariant(typeof body.token === "string", "expected token string");
  return body.token;
}

test("setup: register key", async () => {
  fingerprint = await toFingerprint(keys.publicKey);
  const res = await uploadKey(keys.publicKey);
  const body = await res.json();
  invariant(typeof body.userId === "string", "expected userId string");
  userId = body.userId;
});

test("returns 401 without a token", async () => {
  const res = await fetchEncapsulationKey(userId, "");
  expect(res.status).toBe(401);
});

test("returns encapsulation public key for a valid user", async () => {
  const token = await authenticate();

  const res = await fetchEncapsulationKey(userId, token);
  expect(res.status).toBe(200);

  const body = await res.json();
  expect(body.userId).toBe(userId);
  expect(typeof body.encapsulationPublicKey).toBe("string");
  expect(body.encapsulationPublicKey.length).toBeGreaterThan(0);
});

test("returns 404 for a non-existent user", async () => {
  const token = await authenticate();

  const res = await fetchEncapsulationKey(
    "00000000-0000-0000-0000-000000000000",
    token,
  );
  expect(res.status).toBe(404);
  const body = await res.json();
  expect(body.error).toBe("User not found");
});
