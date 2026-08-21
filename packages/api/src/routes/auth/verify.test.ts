import { afterAll, expect, test } from "bun:test";
import {
  authChallengeSigningBytes,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  ML_DSA87_SIGNATURE_BYTES,
  sign,
  toFingerprint,
} from "@symcrypt/crypto";
import invariant from "invariant";
import {
  requestChallenge,
  submitRegistration,
  submitVerify,
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

test("authenticates with a valid signature", async () => {
  fingerprint = await toFingerprint(signingKeys.signingPublicKey);
  const registrationRes = await submitRegistration(
    signingKeys.signingPublicKey,
    signingKeys.signingPrivateKey,
    kemKeys.publicKey,
  );
  expect(registrationRes.status).toBe(200);
  const registrationBody = await registrationRes.json();

  const challengeRes = await requestChallenge(fingerprint);
  const { challenge } = await challengeRes.json();
  invariant(typeof challenge === "string", "expected challenge string");

  const signature = sign(
    authChallengeSigningBytes({ challengeHex: challenge, fingerprint }),
    signingKeys.signingPrivateKey,
  );

  const res = await submitVerify(fingerprint, signature);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.authenticated).toBe(true);
  expect(typeof body.token).toBe("string");
  expect(body.organizationId).toBe(registrationBody.organizationId);
  expect(body.userId).toBe(registrationBody.userId);
});

test("returns 401 when no challenge exists", async () => {
  const res = await submitVerify(
    fingerprint,
    new Uint8Array(ML_DSA87_SIGNATURE_BYTES),
  );
  expect(res.status).toBe(401);
});

test("returns 401 with wrong secret key", async () => {
  const challengeRes = await requestChallenge(fingerprint);
  const { challenge } = await challengeRes.json();

  const wrongKeys = generateSigningSeedAndKeyPair();
  const signature = sign(
    authChallengeSigningBytes({ challengeHex: challenge, fingerprint }),
    wrongKeys.signingPrivateKey,
  );

  const res = await submitVerify(fingerprint, signature);
  expect(res.status).toBe(401);
  const body = await res.json();
  expect(body.authenticated).toBe(false);
});

test("challenge is consumed after use", async () => {
  const challengeRes = await requestChallenge(fingerprint);
  const { challenge } = await challengeRes.json();

  const signature = sign(
    authChallengeSigningBytes({ challengeHex: challenge, fingerprint }),
    signingKeys.signingPrivateKey,
  );

  const first = await submitVerify(fingerprint, signature);
  expect(first.status).toBe(200);

  const replay = await submitVerify(fingerprint, signature);
  expect(replay.status).toBe(401);
});

test("rejects malformed verify requests through the shared schema", async () => {
  const res = await routeApp.request("/auth/verify", {
    body: JSON.stringify({ fingerprint: "a".repeat(64), signature: [0] }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "Invalid request" });
});
