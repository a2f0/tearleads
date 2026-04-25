import { afterEach, expect, test } from "bun:test";
import {
  computePrincipalStatePayloadCiphertextHash,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  hexToBytes,
  sign,
  signPrincipalState,
  toFingerprint,
  wrapDekForRecipients,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
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
  signingPrivateKey: Uint8Array,
  encapsulationPublicKey: Uint8Array,
): Promise<{ userId: string }> {
  const dek = crypto.getRandomValues(new Uint8Array(32));
  const recipients = await wrapDekForRecipients(dek, [encapsulationPublicKey]);
  const wrappedEnvelope = recipients[0];
  invariant(wrappedEnvelope, "Expected wrapped DEK envelope.");
  const userId = crypto.randomUUID();
  const organizationId = crypto.randomUUID();
  const organizationKem = generateKemSeedAndKeyPair();
  const projection = [
    {
      memberPrincipalType: "user" as const,
      memberPrincipalId: userId,
      role: "admin" as const,
    },
  ];
  const payloadCiphertext = bytesToBase64(
    new TextEncoder().encode(JSON.stringify({ members: projection })),
  );
  const [organizationMemberEnvelope] = await wrapDekForRecipients(
    organizationKem.secretKey,
    [encapsulationPublicKey],
  );
  invariant(
    organizationMemberEnvelope,
    "Expected organization member envelope.",
  );

  const response = await fetch(`${apiBaseUrl}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId,
      organizationId,
      rootContainerId: crypto.randomUUID(),
      signingPublicKey: Array.from(signingPublicKey),
      encapsulationPublicKey: Array.from(encapsulationPublicKey),
      initialOrganizationPolicy: {
        state: await signPrincipalState(
          {
            principalType: "organization",
            principalId: organizationId,
            version: 1,
            prevStateHash: null,
            keyEpoch: 1,
            encapsulationPublicKey: bytesToBase64(organizationKem.publicKey),
            keyFingerprint: await toFingerprint(organizationKem.publicKey),
            members: [{ principalType: "user", principalId: userId }],
            projection,
            payloadCiphertext,
            signedAt: new Date("2026-04-07T00:00:00.000Z").toISOString(),
            signerUserId: userId,
            signerUserKeyFingerprint: await toFingerprint(signingPublicKey),
          },
          signingPrivateKey,
        ),
        encryptedPayload: {
          cipherSuite: "aes-256-gcm-v1",
          ciphertext: payloadCiphertext,
          ciphertextHash:
            await computePrincipalStatePayloadCiphertextHash(payloadCiphertext),
        },
        projection,
        memberEnvelopes: [
          {
            memberPrincipalType: "user",
            memberPrincipalId: userId,
            memberKeyFingerprint: await toFingerprint(encapsulationPublicKey),
            kemCipherText: bytesToBase64(
              organizationMemberEnvelope.kemCipherText,
            ),
            wrappedKey: bytesToBase64(organizationMemberEnvelope.wrappedKey),
          },
        ],
      },
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
    signingKeys.signingPrivateKey,
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
