import { afterAll, expect, test } from "bun:test";
import { generateSeedAndKeyPair, toFingerprint } from "@tearleads/crypto";
import invariant from "invariant";
import { requestChallenge, uploadKey } from "../../../test/helpers/api";
import { del } from "../../adapters/redis";

const keys = generateSeedAndKeyPair();
let fingerprint: string;

afterAll(async () => {
  await del(fingerprint);
  await del(`challenge:${fingerprint}`);
});

test("returns a challenge for a known fingerprint", async () => {
  fingerprint = await toFingerprint(keys.publicKey);
  await uploadKey(keys.publicKey);

  const res = await requestChallenge(fingerprint);
  expect(res.status).toBe(200);

  const { challenge } = await res.json();
  invariant(typeof challenge === "string", "expected challenge string");
  expect(challenge.length).toBe(64);
});

test("returns 404 for an unknown fingerprint", async () => {
  const res = await requestChallenge("nonexistent");
  expect(res.status).toBe(404);
});
