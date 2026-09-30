import { afterAll, expect, test } from "bun:test";
import {
  authChallengeSigningBytes,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  sign,
  toFingerprint,
} from "@tearleads/crypto";
import invariant from "invariant";
import { submitRegistration } from "../../../test/helpers/api";
import { del } from "../../adapters/redis";
import { createRouteApp } from "../../routeApp";

// Behind the production tunnel the request URL is a loopback address, so the
// configured public origin, never the request's own, is what must be signed.
const PUBLIC_ORIGIN = "https://api.example.test";
const app = createRouteApp({}, { publicOrigin: PUBLIC_ORIGIN });
const signingKeys = generateSigningSeedAndKeyPair();
const kemKeys = generateKemSeedAndKeyPair();
let fingerprint = "";

afterAll(async () => {
  await del(fingerprint);
  await del(`challenge:${fingerprint}`);
});

async function signedVerify(apiOrigin: string): Promise<Response> {
  const challengeResponse = await app.request("/auth/challenge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fingerprint }),
  });
  const { challenge } = await challengeResponse.json();
  invariant(typeof challenge === "string", "expected challenge string");
  const signature = sign(
    authChallengeSigningBytes({
      apiOrigin,
      challengeHex: challenge,
      fingerprint,
    }),
    signingKeys.signingPrivateKey,
  );
  return app.request("/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fingerprint, signature: Array.from(signature) }),
  });
}

test("a configured public origin is the one challenges must be signed for", async () => {
  fingerprint = await toFingerprint(signingKeys.signingPublicKey);
  const registration = await submitRegistration(
    signingKeys.signingPublicKey,
    signingKeys.signingPrivateKey,
    kemKeys.publicKey,
  );
  expect(registration.status).toBe(200);

  // The request arrives at http://localhost, which is not the public origin.
  const requestOrigin = await signedVerify("http://localhost");
  expect(requestOrigin.status).toBe(401);
  expect(await requestOrigin.json()).toEqual({
    authenticated: false,
    error: "Invalid signature",
  });

  const configured = await signedVerify(PUBLIC_ORIGIN);
  expect(configured.status).toBe(200);
  expect((await configured.json()).authenticated).toBe(true);
});
