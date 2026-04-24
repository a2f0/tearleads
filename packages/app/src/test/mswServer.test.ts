import { afterEach, expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  hexToBytes,
  sign,
  toFingerprint,
  wrapDekForRecipients,
} from "@tearleads/crypto";
import invariant from "invariant";
import {
  resetMockServer,
  useTestApiAppHandlers,
} from "../../test/helpers/mswServer";

const apiBaseUrl = "http://localhost:3001";

afterEach(async () => {
  await resetMockServer();
});

async function registerIdentity(
  signingPublicKey: Uint8Array,
  encapsulationPublicKey: Uint8Array,
): Promise<{ userId: string }> {
  const dek = crypto.getRandomValues(new Uint8Array(32));
  const recipients = await wrapDekForRecipients(dek, [encapsulationPublicKey]);
  const wrappedEnvelope = recipients[0];
  invariant(wrappedEnvelope, "Expected wrapped DEK envelope.");

  const response = await fetch(`${apiBaseUrl}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      rootContainerId: crypto.randomUUID(),
      signingPublicKey: Array.from(signingPublicKey),
      encapsulationPublicKey: Array.from(encapsulationPublicKey),
      initialRootMetadataUpdates: [],
      wrappedDekEnvelope: {
        keyFingerprint: wrappedEnvelope.keyFingerprint,
        kemCipherText: Array.from(wrappedEnvelope.kemCipherText),
        wrappedKey: Array.from(wrappedEnvelope.wrappedKey),
      },
    }),
  });

  expect(response.status).toBe(200);
  const body = await response.json();
  invariant(typeof body.userId === "string", "Expected register userId.");

  return {
    userId: body.userId,
  };
}

async function requestChallenge(fingerprint: string): Promise<Response> {
  return fetch(`${apiBaseUrl}/auth/challenge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fingerprint }),
  });
}

async function verifySession(
  fingerprint: string,
  signature: Uint8Array,
): Promise<Response> {
  return fetch(`${apiBaseUrl}/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fingerprint,
      signature: Array.from(signature),
    }),
  });
}

async function requestEncapsulationKey(
  token: string,
  userId: string,
): Promise<Response> {
  return fetch(`${apiBaseUrl}/auth/encapsulation-key/${userId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
}

test("resetMockServer recreates isolated auth state for the proxied test API app", async () => {
  useTestApiAppHandlers();

  const signingKeys = generateSigningSeedAndKeyPair();
  const kemKeys = generateKemSeedAndKeyPair();
  const fingerprint = await toFingerprint(signingKeys.signingPublicKey);
  const { userId } = await registerIdentity(
    signingKeys.signingPublicKey,
    kemKeys.publicKey,
  );

  const challengeResponse = await requestChallenge(fingerprint);
  expect(challengeResponse.status).toBe(200);
  const challengeBody = await challengeResponse.json();
  invariant(
    typeof challengeBody.challenge === "string",
    "Expected challenge string.",
  );

  const tokenResponse = await verifySession(
    fingerprint,
    sign(hexToBytes(challengeBody.challenge), signingKeys.signingPrivateKey),
  );
  expect(tokenResponse.status).toBe(200);
  const tokenBody = await tokenResponse.json();
  invariant(typeof tokenBody.token === "string", "Expected session token.");

  const authenticatedResponse = await requestEncapsulationKey(
    tokenBody.token,
    userId,
  );
  expect(authenticatedResponse.status).toBe(200);

  await resetMockServer();
  useTestApiAppHandlers();

  const staleSessionResponse = await requestEncapsulationKey(
    tokenBody.token,
    userId,
  );
  expect(staleSessionResponse.status).toBe(401);

  const resetChallengeResponse = await requestChallenge(fingerprint);
  expect(resetChallengeResponse.status).toBe(404);
});
