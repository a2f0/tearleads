import { db as defaultDb } from "@symcrypt/api-shared/postgres";
import type { TestUser } from "@symcrypt/bob-and-alice";
import {
  buildPrincipalStateSigningInput,
  computePrincipalStateHash,
  computePrincipalStatePayloadCiphertextHash,
  generateKemSeedAndKeyPair,
  signPrincipalState,
  toFingerprint,
  wrapDekForRecipients,
} from "@symcrypt/crypto";
import { bytesToBase64 } from "@symcrypt/encoding";
import type { RegistrationRequest } from "@symcrypt/validators/request";
import {
  type BlobObjectStore,
  createMemoryBlobObjectStore,
} from "../../src/adapters/blobObjectStore";
import type { ApiServiceRuntime } from "../../src/services/runtime";
import {
  createInitialAdminGroupRequest,
  createInitialMemberGroupRequest,
  createRegistrationBootstrap,
} from "./registration";

export function createServiceTestRuntime(
  db: ApiServiceRuntime["db"] = defaultDb,
  overrides: {
    readonly blobObjectStore?: BlobObjectStore;
  } = {},
): ApiServiceRuntime {
  const values = new Map<string, string>();

  return {
    blobObjectStore: overrides.blobObjectStore ?? createMemoryBlobObjectStore(),
    db,
    eventPublisher: {
      publish: async () => {},
    },
    keyValueStore: {
      del: async (key) => {
        values.delete(key);
      },
      get: async (key) => values.get(key) ?? null,
      getdel: async (key) => {
        const value = values.get(key) ?? null;
        values.delete(key);
        return value;
      },
      set: async (key, value) => {
        values.set(key, value);
      },
    },
    sessionTokenIssuer: {
      createSession: async () => "test-session",
    },
  };
}

export function createFailingRuntime(
  onPublish?: (event: Record<string, unknown>) => void,
  db: ApiServiceRuntime["db"] = defaultDb,
): ApiServiceRuntime {
  return {
    ...createServiceTestRuntime(db),
    eventPublisher: {
      publish: async (event) => {
        onPublish?.(event);
        throw new Error("broker unavailable");
      },
    },
  };
}

export async function createRegistrationRequest(
  user: TestUser,
): Promise<RegistrationRequest> {
  const userId = user.userId || crypto.randomUUID();
  const organizationId = crypto.randomUUID();
  const rootContainerId = crypto.randomUUID();
  const organizationKem = generateKemSeedAndKeyPair();
  const initialOrganizationProjection = [
    {
      userId: userId,
      role: "admin" as const,
    },
  ];
  const [organizationMemberEnvelope] = await wrapDekForRecipients(
    organizationKem.secretKey,
    [user.kem.publicKey],
  );

  if (!organizationMemberEnvelope) {
    throw new Error("Failed to wrap organization key for test user");
  }
  const organizationMemberEnvelopes = [
    {
      userId: userId,
      memberKeyFingerprint: await toFingerprint(user.kem.publicKey),
      kemCipherText: bytesToBase64(organizationMemberEnvelope.kemCipherText),
      wrappedKey: bytesToBase64(organizationMemberEnvelope.wrappedKey),
    },
  ];
  const initialAdminGroup = await createInitialAdminGroupRequest({
    encapsulationPublicKey: user.kem.publicKey,
    grants: [{ containerId: rootContainerId, accessLevel: "admin" }],
    signingPrivateKey: user.signing.signingPrivateKey,
    signingPublicKey: user.signing.signingPublicKey,
    userId,
  });
  const initialMemberGroup = await createInitialMemberGroupRequest({
    encapsulationPublicKey: user.kem.publicKey,
    signingPrivateKey: user.signing.signingPrivateKey,
    signingPublicKey: user.signing.signingPublicKey,
    userId,
  });
  const organizationPayloadCiphertext = bytesToBase64(
    new TextEncoder().encode(
      JSON.stringify({
        version: 2,
        organizationId,
        adminGroupId: initialAdminGroup.groupId,
        memberGroupId: initialMemberGroup.groupId,
        groupHeads: await Promise.all(
          [initialAdminGroup, initialMemberGroup]
            .sort((left, right) => left.groupId.localeCompare(right.groupId))
            .map(async (group) => ({
              principalType: "group" as const,
              principalId: group.groupId,
              version: group.initialGroupPolicy.state.version,
              keyEpoch: group.initialGroupPolicy.state.keyEpoch,
              stateHash: await computePrincipalStateHash(
                group.initialGroupPolicy.state,
              ),
              keyFingerprint: group.initialGroupPolicy.state.keyFingerprint,
            })),
        ),
      }),
    ),
  );
  const rootBootstrap = await createRegistrationBootstrap({
    adminGroup: initialAdminGroup,
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
    initialAdminGroup,
    initialMemberGroup,
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
          members: [{ userId }],
          memberEnvelopes: organizationMemberEnvelopes,
          projection: initialOrganizationProjection,
          grants: [],
          payloadCiphertext: organizationPayloadCiphertext,
          externalAuthority: null,
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
      grants: [],
      memberEnvelopes: organizationMemberEnvelopes,
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
