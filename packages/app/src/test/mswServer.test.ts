import { afterEach, expect, test } from "bun:test";
import {
  authChallengeSigningBytes,
  buildPrincipalStateSigningInput,
  computePrincipalStatePayloadCiphertextHash,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
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
import {
  buildRootContainerCreatePlan,
  rootContainerWriterProjectionFromCreatePlan,
} from "../data/containers/containerRuntime";
import { createDocumentSignerDeviceId } from "../data/documents/documentConstants";
import { buildMaterializedDocumentCreatePlan } from "../data/documents/documentRuntime";

const apiBaseUrl = "http://localhost:3001";

afterEach(async () => {
  await resetMockServer();
});

async function registerIdentity(
  signingPublicKey: Uint8Array,
  signingPrivateKey: Uint8Array,
  encapsulationPublicKey: Uint8Array,
  encapsulationSecretKey: Uint8Array,
): Promise<{ userId: string }> {
  const userId = crypto.randomUUID();
  const organizationId = crypto.randomUUID();
  const rootContainerId = crypto.randomUUID();
  const rootMetadataDocumentId = crypto.randomUUID();
  const signingFingerprint = await toFingerprint(signingPublicKey);
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
  const author = {
    organizationId,
    signerDeviceId: createDocumentSignerDeviceId(signingFingerprint),
    signerKeyFingerprint: signingFingerprint,
    signerPrivateKey: signingPrivateKey,
    signerUserId: userId,
  };
  const rootContainer = await buildRootContainerCreatePlan({
    author: author,
    containerId: rootContainerId,
    metadataDocumentId: rootMetadataDocumentId,
    recipientEncapsulationPublicKey: encapsulationPublicKey,
    signedAt: new Date("2026-04-07T00:00:00.000Z").toISOString(),
  });
  const rootMetadataDocument = await buildMaterializedDocumentCreatePlan({
    author: author,
    containerProjection: rootContainerWriterProjectionFromCreatePlan(
      rootContainer.plan,
    ),
    documentId: rootMetadataDocumentId,
    signedAt: new Date("2026-04-07T00:00:00.000Z").toISOString(),
    targetSecretKey: encapsulationSecretKey,
  });

  const response = await fetch(`${apiBaseUrl}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId,
      organizationId,
      rootContainerId,
      signingPublicKey: Array.from(signingPublicKey),
      encapsulationPublicKey: Array.from(encapsulationPublicKey),
      initialOrganizationPolicy: {
        state: await signPrincipalState(
          await buildPrincipalStateSigningInput({
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
            signerUserKeyFingerprint: signingFingerprint,
          }),
          signingPrivateKey,
        ),
        encryptedPayload: {
          cipherSuite: "aes-256-gcm",
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
      initialRootContainer: rootContainer.plan.request,
      initialRootMetadataDocument: rootMetadataDocument.plan.request,
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
    kemKeys.secretKey,
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
    sign(
      authChallengeSigningBytes({
        challengeHex: challengeBody.challenge,
        fingerprint,
      }),
      signingKeys.signingPrivateKey,
    ),
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
}, 10_000);
