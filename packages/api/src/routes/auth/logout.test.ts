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
  requestChallenge,
  submitLogout,
  submitRegistration,
  submitVerify,
} from "../../../test/helpers/api";
import { del } from "../../adapters/redis";

const signingKeys = generateSigningSeedAndKeyPair();
const kemKeys = generateKemSeedAndKeyPair();
let fingerprint: string;

afterAll(async () => {
  await del(fingerprint);
});

// Note: this does not require storing the key on the server.
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
  await submitRegistration(
    signingKeys.signingPublicKey,
    signingKeys.signingPrivateKey,
    kemKeys.publicKey,
  );
});

test("returns 401 without a token", async () => {
  const res = await submitLogout("");
  expect(res.status).toBe(401);
});

test("destroys session on logout", async () => {
  const token = await authenticate();

  const res = await submitLogout(token);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ message: "ok" });
});

test("returns 401 when using a destroyed session", async () => {
  const token = await authenticate();

  const first = await submitLogout(token);
  expect(first.status).toBe(200);

  const second = await submitLogout(token);
  expect(second.status).toBe(401);
});
