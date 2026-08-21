import { afterAll, expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
} from "@symcrypt/crypto";
import invariant from "invariant";
import {
  requestChallenge,
  submitRegistration,
} from "../../../test/helpers/api";
import { del } from "../../adapters/redis";
import { routeApp } from "../../routeApp";

const signingKeys = generateSigningSeedAndKeyPair();
const kemKeys = generateKemSeedAndKeyPair();
let fingerprint: string;

afterAll(async () => {
  await del(fingerprint);
  await del(`challenge:${fingerprint}`);
});

test("returns a challenge for a known fingerprint", async () => {
  fingerprint = await toFingerprint(signingKeys.signingPublicKey);
  await submitRegistration(
    signingKeys.signingPublicKey,
    signingKeys.signingPrivateKey,
    kemKeys.publicKey,
  );

  const res = await requestChallenge(fingerprint);
  expect(res.status).toBe(200);

  const { challenge } = await res.json();
  invariant(typeof challenge === "string", "expected challenge string");
  expect(challenge.length).toBe(64);
});

test("returns 404 for an unknown fingerprint", async () => {
  const res = await requestChallenge("0".repeat(64));
  expect(res.status).toBe(404);
});

test("rejects malformed challenge requests through the shared schema", async () => {
  const res = await routeApp.request("/auth/challenge", {
    body: JSON.stringify({ fingerprint: "not-a-fingerprint" }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "Invalid request" });
});
