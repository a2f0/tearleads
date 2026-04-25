import {
  computePrincipalStatePayloadCiphertextHash,
  generateKemSeedAndKeyPair,
  signPrincipalState,
  toFingerprint,
  wrapDekForRecipients,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type { PublicKeyRequest } from "@tearleads/validators/request";
import type { PublicKeyResponse } from "@tearleads/validators/response";
import { useCallback } from "react";
import { useApiClient } from "../api/ApiClientProvider";
import { useCryptoSession } from "../crypto/CryptoSessionProvider";
import { createInitializedContainerMetadataDocument } from "../data/containers";
import {
  createDocumentEncryptionMaterial,
  createPendingUpdateFields,
  encryptPendingUpdates,
} from "../data/documentSync";
import { createExecSql } from "../data/persistence/sqlSchema";
import { persistRegistrationBootstrap } from "../data/registrationBootstrapPersistence";
import { useDatabase } from "../db/DatabaseProvider";
import { useLog } from "../logging/LogProvider";
import { useIdentity } from "./IdentityProvider";

interface RegisterCurrentIdentityResult {
  canRegisterCurrentIdentity: boolean;
  registerCurrentIdentity: () => Promise<boolean>;
}

interface InitialRootMetadataBootstrap {
  initialRootMetadataUpdates: Awaited<ReturnType<typeof encryptPendingUpdates>>;
  initialUpdate: Uint8Array;
  rootMetadataRecipientEnvelopes: Awaited<
    ReturnType<typeof createDocumentEncryptionMaterial>
  >["documentRecipientEnvelopes"];
}

async function createInitialOrganizationPolicy(input: {
  encapsulationPublicKey: Uint8Array;
  organizationId: string;
  signingPrivateKey: Uint8Array;
  signingPublicKey: Uint8Array;
  userId: string;
}): Promise<PublicKeyRequest["initialOrganizationPolicy"]> {
  const organizationKem = generateKemSeedAndKeyPair();
  const signerUserKeyFingerprint = await toFingerprint(input.signingPublicKey);
  const userEncapsulationKeyFingerprint = await toFingerprint(
    input.encapsulationPublicKey,
  );
  const projection = [
    {
      memberPrincipalType: "user" as const,
      memberPrincipalId: input.userId,
      role: "admin" as const,
    },
  ];
  const payloadCiphertext = bytesToBase64(
    new TextEncoder().encode(
      JSON.stringify({
        members: projection,
      }),
    ),
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
      signedAt: new Date().toISOString(),
      signerUserId: input.userId,
      signerUserKeyFingerprint,
    },
    input.signingPrivateKey,
  );
  const [memberEnvelope] = await wrapDekForRecipients(
    organizationKem.secretKey,
    [input.encapsulationPublicKey],
  );

  if (!memberEnvelope) {
    throw new Error("Failed to wrap organization key for registering user");
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
        memberKeyFingerprint: userEncapsulationKeyFingerprint,
        kemCipherText: bytesToBase64(memberEnvelope.kemCipherText),
        wrappedKey: bytesToBase64(memberEnvelope.wrappedKey),
      },
    ],
  };
}

async function createInitialRootMetadataBootstrap(
  containerId: string,
  encapsulationPublicKey: Uint8Array,
): Promise<InitialRootMetadataBootstrap> {
  const { initialUpdate } = await createInitializedContainerMetadataDocument(
    containerId,
    {
      icon: null,
      name: "/",
    },
  );
  const initialMetadataDocumentEncryption =
    await createDocumentEncryptionMaterial([encapsulationPublicKey]);
  const pendingUpdateFields = createPendingUpdateFields(initialUpdate);
  const initialRootMetadataUpdates = pendingUpdateFields
    ? await encryptPendingUpdates(
        [
          {
            id: crypto.randomUUID(),
            ...pendingUpdateFields,
          },
        ],
        1,
        initialMetadataDocumentEncryption.documentKey,
      )
    : [];

  return {
    initialRootMetadataUpdates,
    initialUpdate,
    rootMetadataRecipientEnvelopes:
      initialMetadataDocumentEncryption.documentRecipientEnvelopes,
  };
}

async function persistLocalRegistrationState(
  dbClient: ReturnType<typeof useDatabase>["client"],
  containerId: string,
  encapsulationPublicKey: Uint8Array,
  response: PublicKeyResponse,
  bootstrap: InitialRootMetadataBootstrap,
  log: (message: string) => void,
) {
  if (!dbClient) {
    return;
  }

  try {
    await persistRegistrationBootstrap(createExecSql(dbClient), {
      containerId,
      encapsulationPublicKey,
      organizationId: response.organizationId,
      rootMetadataAccessEpoch: response.rootMetadataAccessEpoch,
      rootMetadataAccessStateHash: response.rootMetadataAccessStateHash,
      rootMetadataDocumentId: response.rootMetadataDocumentId,
      rootMetadataRecipientEnvelopes: bootstrap.rootMetadataRecipientEnvelopes,
      rootMetadataSnapshot: bytesToBase64(bootstrap.initialUpdate),
      userId: response.userId,
    });
    log("Local identity and root container persisted");
  } catch (error: unknown) {
    console.error("Failed to persist registration data:", error);
  }
}

async function registerIdentity(input: {
  apiClient: ReturnType<typeof useApiClient>;
  containerId: string;
  dbClient: ReturnType<typeof useDatabase>["client"];
  encapsulationKeyPair: NonNullable<
    ReturnType<typeof useIdentity>["encapsulationKeyPair"]
  >;
  log: (message: string) => void;
  loginWithChallenge: (challenge: string) => Promise<boolean>;
  setOrganizationId: (organizationId: string | null) => void;
  setUserId: (userId: string | null) => void;
  signingKeyPair: NonNullable<ReturnType<typeof useIdentity>["signingKeyPair"]>;
}): Promise<boolean> {
  input.log("Uploading public key...");

  const recipients = await wrapDekForRecipients(
    crypto.getRandomValues(new Uint8Array(32)),
    [input.encapsulationKeyPair.publicKey],
  );
  const wrappedEnvelope = recipients[0];

  if (wrappedEnvelope === undefined) {
    return false;
  }

  const bootstrap = await createInitialRootMetadataBootstrap(
    input.containerId,
    input.encapsulationKeyPair.publicKey,
  );
  const newUserId = crypto.randomUUID();
  const organizationId = crypto.randomUUID();
  const initialOrganizationPolicy = await createInitialOrganizationPolicy({
    encapsulationPublicKey: input.encapsulationKeyPair.publicKey,
    organizationId,
    signingPrivateKey: input.signingKeyPair.signingPrivateKey,
    signingPublicKey: input.signingKeyPair.signingPublicKey,
    userId: newUserId,
  });

  const response = await input.apiClient.postPublicKey(
    newUserId,
    organizationId,
    input.containerId,
    input.signingKeyPair.signingPublicKey,
    input.encapsulationKeyPair.publicKey,
    wrappedEnvelope,
    initialOrganizationPolicy,
    bootstrap.initialRootMetadataUpdates,
    bootstrap.rootMetadataRecipientEnvelopes,
  );
  if (!response) {
    return false;
  }

  input.log(`Key registered (${response.userId})`);
  input.setUserId(response.userId);
  input.setOrganizationId(response.organizationId);
  await persistLocalRegistrationState(
    input.dbClient,
    input.containerId,
    input.encapsulationKeyPair.publicKey,
    response,
    bootstrap,
    input.log,
  );

  await input.loginWithChallenge(response.challenge);
  return true;
}

export function useRegisterCurrentIdentity(): RegisterCurrentIdentityResult {
  const { client: dbClient } = useDatabase();
  const {
    userId,
    containerId,
    setUserId,
    setOrganizationId,
    loginWithChallenge,
  } = useCryptoSession();
  const { encapsulationKeyPair, signingKeyPair } = useIdentity();
  const { log } = useLog();
  const apiClient = useApiClient();

  const canRegisterCurrentIdentity =
    signingKeyPair !== null &&
    encapsulationKeyPair !== null &&
    userId === null &&
    containerId !== null;

  const registerCurrentIdentity = useCallback(async (): Promise<boolean> => {
    if (
      signingKeyPair === null ||
      encapsulationKeyPair === null ||
      userId !== null ||
      containerId === null
    ) {
      return false;
    }

    return registerIdentity({
      apiClient,
      containerId,
      dbClient,
      encapsulationKeyPair,
      log,
      loginWithChallenge,
      setOrganizationId,
      setUserId,
      signingKeyPair,
    });
  }, [
    apiClient,
    containerId,
    dbClient,
    encapsulationKeyPair,
    log,
    loginWithChallenge,
    setOrganizationId,
    setUserId,
    signingKeyPair,
    userId,
  ]);

  return { canRegisterCurrentIdentity, registerCurrentIdentity };
}
