import { afterAll, expect, test } from "bun:test";
import {
  generateSeedAndKeyPair,
  hexToBytes,
  sign,
  toFingerprint,
} from "@tearleads/crypto";
import invariant from "invariant";
import {
  requestChallenge,
  submitVerify,
  uploadKey,
} from "../../../test/helpers/api";
import { del } from "../../adapters/redis";

const keys = generateSeedAndKeyPair();
let fingerprint: string;

afterAll(async () => {
  await del(fingerprint);
  await del(`challenge:${fingerprint}`);
});

test("authenticates with a valid signature", async () => {
  fingerprint = await toFingerprint(keys.publicKey);
  await uploadKey(keys.publicKey);

  const challengeRes = await requestChallenge(fingerprint);
  const { challenge } = await challengeRes.json();
  invariant(typeof challenge === "string", "expected challenge string");

  const signature = sign(hexToBytes(challenge), keys.secretKey);

  const res = await submitVerify(fingerprint, signature);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ authenticated: true });
});

test("returns 401 when no challenge exists", async () => {
  const res = await submitVerify(fingerprint, new Uint8Array(32));
  expect(res.status).toBe(401);
});

test("returns 401 with wrong secret key", async () => {
  const challengeRes = await requestChallenge(fingerprint);
  const { challenge } = await challengeRes.json();

  const wrongKeys = generateSeedAndKeyPair();
  const signature = sign(hexToBytes(challenge), wrongKeys.secretKey);

  const res = await submitVerify(fingerprint, signature);
  expect(res.status).toBe(401);
  const body = await res.json();
  expect(body.authenticated).toBe(false);
});

test("challenge is consumed after use", async () => {
  const challengeRes = await requestChallenge(fingerprint);
  const { challenge } = await challengeRes.json();

  const signature = sign(hexToBytes(challenge), keys.secretKey);

  const first = await submitVerify(fingerprint, signature);
  expect(first.status).toBe(200);

  const replay = await submitVerify(fingerprint, signature);
  expect(replay.status).toBe(401);
});
