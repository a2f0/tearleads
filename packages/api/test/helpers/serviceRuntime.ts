import type { TestUser } from "@tearleads/bob-and-alice";
import {
  buildPrincipalStateSigningInput,
  computePrincipalStatePayloadCiphertextHash,
  generateKemSeedAndKeyPair,
  signPrincipalState,
  toFingerprint,
  wrapDekForRecipients,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type { PublicKeyRequest } from "@tearleads/validators/request";
import { db as defaultDb } from "../../src/adapters/postgres";
import type { ApiServiceRuntime } from "../../src/services/runtime";
import { createRegistrationBootstrap } from "./registration";

export function createServiceTestRuntime(
  db: ApiServiceRuntime["db"] = defaultDb,
): ApiServiceRuntime {
  const values = new Map<string, string>();

  return {
    db,
    eventPublisher: {
      publish: async () => {},
    },
    keyValueStore: {
      del: async (key) => {
        values.delete(key);
      },
      get: async (key) => values.get(key) ?? null,
      set: async (key, value) => {
        values.set(key, value);
      },
    },
    sessionTokenIssuer: {
      createSession: async () => "test-session",
    },
  };
}

export async function createPublicKeyRequest(
  user: TestUser,
): Promise<PublicKeyRequest> {
  const userId = user.userId || crypto.randomUUID();
  const organizationId = crypto.randomUUID();
  const rootContainerId = crypto.randomUUID();
  const organizationKem = generateKemSeedAndKeyPair();
  const initialOrganizationProjection = [
    {
      memberPrincipalType: "user" as const,
      memberPrincipalId: userId,
      role: "admin" as const,
    },
  ];
  const organizationPayloadCiphertext = bytesToBase64(
    new TextEncoder().encode(
      JSON.stringify({ members: initialOrganizationProjection }),
    ),
  );
  const [organizationMemberEnvelope] = await wrapDekForRecipients(
    organizationKem.secretKey,
    [user.kem.publicKey],
  );

  if (!organizationMemberEnvelope) {
    throw new Error("Failed to wrap organization key for test user");
  }
  const rootBootstrap = await createRegistrationBootstrap({
    encapsulationPublicKey: user.kem.publicKey,
    organizationId,
    rootContainerId,
    signingPrivateKey: user.signing.signingPrivateKey,
    signingPublicKey: user.signing.signingPublicKey,
    userId,
  });

  return {
    userId,
    organizationId,
    rootContainerId,
    signingPublicKey: Array.from(user.signing.signingPublicKey),
    encapsulationPublicKey: Array.from(user.kem.publicKey),
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
          projection: initialOrganizationProjection,
          payloadCiphertext: organizationPayloadCiphertext,
          signedAt: new Date("2026-04-07T00:00:00.000Z").toISOString(),
          signerUserId: userId,
          signerUserKeyFingerprint: await toFingerprint(
            user.signing.signingPublicKey,
          ),
        }),
        user.signing.signingPrivateKey,
      ),
      encryptedPayload: {
        cipherSuite: "aes-256-gcm",
        ciphertext: organizationPayloadCiphertext,
        ciphertextHash: await computePrincipalStatePayloadCiphertextHash(
          organizationPayloadCiphertext,
        ),
      },
      projection: initialOrganizationProjection,
      memberEnvelopes: [
        {
          memberPrincipalType: "user",
          memberPrincipalId: userId,
          memberKeyFingerprint: await toFingerprint(user.kem.publicKey),
          kemCipherText: bytesToBase64(
            organizationMemberEnvelope.kemCipherText,
          ),
          wrappedKey: bytesToBase64(organizationMemberEnvelope.wrappedKey),
        },
      ],
    },
    initialRootContainer: rootBootstrap.initialRootContainer,
    initialRootMetadataDocument: rootBootstrap.initialRootMetadataDocument,
  };
}

export function createRecordingDb(): {
  calls: ReadonlyMap<string, number>;
  db: ApiServiceRuntime["db"];
} {
  const calls = new Map<string, number>();
  const db = new Proxy(defaultDb, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);

      if (typeof property !== "string" || typeof value !== "function") {
        return value;
      }

      return (...args: unknown[]) => {
        calls.set(property, (calls.get(property) ?? 0) + 1);
        return Reflect.apply(value, target, args);
      };
    },
  }) as ApiServiceRuntime["db"];

  return { calls, db };
}
