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
const PUBLIC_ORIGIN_ENV = "API_PUBLIC_ORIGIN";
const registeredFingerprints: string[] = [];

afterAll(async () => {
  for (const fingerprint of registeredFingerprints) {
    await del(fingerprint);
    await del(`challenge:${fingerprint}`);
  }
});

type RouteApp = ReturnType<typeof createRouteApp>;

interface RegisteredSigner {
  readonly fingerprint: string;
  readonly signingPrivateKey: Uint8Array;
}

async function registerSigner(): Promise<RegisteredSigner> {
  const signingKeys = generateSigningSeedAndKeyPair();
  const kemKeys = generateKemSeedAndKeyPair();
  const fingerprint = await toFingerprint(signingKeys.signingPublicKey);
  registeredFingerprints.push(fingerprint);
  const registration = await submitRegistration(
    signingKeys.signingPublicKey,
    signingKeys.signingPrivateKey,
    kemKeys.publicKey,
  );
  expect(registration.status).toBe(200);
  return { fingerprint, signingPrivateKey: signingKeys.signingPrivateKey };
}

async function signedVerify(
  app: RouteApp,
  signer: RegisteredSigner,
  apiOrigin: string,
): Promise<Response> {
  const { fingerprint } = signer;
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
    signer.signingPrivateKey,
  );
  return app.request("/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fingerprint, signature: Array.from(signature) }),
  });
}

async function expectOnlyOriginVerifies(
  app: RouteApp,
  configuredOrigin: string,
): Promise<void> {
  const signer = await registerSigner();

  // The request arrives at http://localhost, which is not the public origin.
  const requestOrigin = await signedVerify(app, signer, "http://localhost");
  expect(requestOrigin.status).toBe(401);
  expect(await requestOrigin.json()).toEqual({
    authenticated: false,
    error: "Invalid signature",
  });

  const configured = await signedVerify(app, signer, configuredOrigin);
  expect(configured.status).toBe(200);
  expect((await configured.json()).authenticated).toBe(true);
}

test("a configured public origin is the one challenges must be signed for", async () => {
  await expectOnlyOriginVerifies(
    createRouteApp({}, { publicOrigin: PUBLIC_ORIGIN }),
    PUBLIC_ORIGIN,
  );
});

test("the route app reads its public origin from API_PUBLIC_ORIGIN", async () => {
  const previous = process.env[PUBLIC_ORIGIN_ENV];
  process.env[PUBLIC_ORIGIN_ENV] = `${PUBLIC_ORIGIN}/`;
  let app: RouteApp;
  try {
    app = createRouteApp({});
  } finally {
    if (previous === undefined) {
      delete process.env[PUBLIC_ORIGIN_ENV];
    } else {
      process.env[PUBLIC_ORIGIN_ENV] = previous;
    }
  }
  await expectOnlyOriginVerifies(app, PUBLIC_ORIGIN);
});
