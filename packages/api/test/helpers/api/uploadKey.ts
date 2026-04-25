import {
  computePrincipalStatePayloadCiphertextHash,
  generateKemSeedAndKeyPair,
  signPrincipalState,
  toFingerprint,
  wrapDekForRecipients,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type { SyncDocumentOutgoingUpdate } from "@tearleads/loro";
import type { PublicKeyRequest } from "@tearleads/validators/request";
import { routeApp } from "../../../src/routeApp";

async function createInitialOrganizationPolicy(input: {
  encapsulationPublicKey: Uint8Array;
  organizationId: string;
  signingPrivateKey: Uint8Array;
  signingPublicKey: Uint8Array;
  userId: string;
}): Promise<PublicKeyRequest["initialOrganizationPolicy"]> {
  const organizationKem = generateKemSeedAndKeyPair();
  const projection = [
    {
      memberPrincipalType: "user" as const,
      memberPrincipalId: input.userId,
      role: "admin" as const,
    },
  ];
  const payloadCiphertext = bytesToBase64(
    new TextEncoder().encode(JSON.stringify({ members: projection })),
  );
  const state = await signPrincipalState(
    {
      principalType: "organization",
      principalId: input.organizationId,
      version: 1,
      prevStateHash: null,
      keyEpoch: 1,
      encapsulationPublicKey: bytesToBase64(organizationKem.publicKey),
      keyFingerprint: await toFingerprint(organizationKem.publicKey),
      members: [{ principalType: "user", principalId: input.userId }],
      projection,
      payloadCiphertext,
      signedAt: new Date("2026-04-07T00:00:00.000Z").toISOString(),
      signerUserId: input.userId,
      signerUserKeyFingerprint: await toFingerprint(input.signingPublicKey),
    },
    input.signingPrivateKey,
  );
  const [memberEnvelope] = await wrapDekForRecipients(
    organizationKem.secretKey,
    [input.encapsulationPublicKey],
  );

  if (!memberEnvelope) {
    throw new Error("Failed to wrap organization key for test user");
  }

  return {
    state,
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
        memberPrincipalId: input.userId,
        memberKeyFingerprint: await toFingerprint(input.encapsulationPublicKey),
        kemCipherText: bytesToBase64(memberEnvelope.kemCipherText),
        wrappedKey: bytesToBase64(memberEnvelope.wrappedKey),
      },
    ],
  };
}

export async function uploadKey(
  signingPublicKey: Uint8Array,
  signingPrivateKey: Uint8Array,
  encapsulationPublicKey: Uint8Array,
  initialRootMetadataUpdates: SyncDocumentOutgoingUpdate[] = [],
): Promise<Response> {
  return routeApp.request("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      await createPublicKeyRequestBody(
        signingPublicKey,
        signingPrivateKey,
        encapsulationPublicKey,
        initialRootMetadataUpdates,
      ),
    ),
  });
}

export async function createPublicKeyRequestBody(
  signingPublicKey: Uint8Array,
  signingPrivateKey: Uint8Array,
  encapsulationPublicKey: Uint8Array,
  initialRootMetadataUpdates: SyncDocumentOutgoingUpdate[] = [],
): Promise<PublicKeyRequest> {
  const dek = crypto.getRandomValues(new Uint8Array(32));
  const recipients = await wrapDekForRecipients(dek, [encapsulationPublicKey]);
  const wrappedEnvelope = recipients[0];

  if (!wrappedEnvelope) {
    throw new Error("Failed to wrap DEK for test user");
  }
  const userId = crypto.randomUUID();
  const organizationId = crypto.randomUUID();

  return {
    userId,
    organizationId,
    rootContainerId: crypto.randomUUID(),
    signingPublicKey: Array.from(signingPublicKey),
    encapsulationPublicKey: Array.from(encapsulationPublicKey),
    initialOrganizationPolicy: await createInitialOrganizationPolicy({
      encapsulationPublicKey,
      organizationId,
      signingPrivateKey,
      signingPublicKey,
      userId,
    }),
    initialRootMetadataUpdates,
    wrappedDekEnvelope: {
      keyFingerprint: wrappedEnvelope.keyFingerprint,
      kemCipherText: Array.from(wrappedEnvelope.kemCipherText),
      wrappedKey: Array.from(wrappedEnvelope.wrappedKey),
    },
  };
}
