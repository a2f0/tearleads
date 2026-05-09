import {
  buildPrincipalStateSigningInput,
  generateKemSeedAndKeyPair,
  signPrincipalState,
  toFingerprint,
  wrapDekForRecipients,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type { RegistrationRequest } from "@tearleads/validators/request";
import type { RegistrationResponse } from "@tearleads/validators/response";
import { useCallback } from "react";
import { useApiClient } from "../providers/api/ApiClientProvider";
import { useCryptoSession } from "../providers/crypto/CryptoSessionProvider";
import { useDatabase } from "../providers/db/DatabaseProvider";
import { useIdentity } from "../providers/identity/IdentityProvider";
import { useLog } from "../providers/logging/LogProvider";
import {
  buildRootContainerCreatePlan,
  rootContainerWriterProjectionFromCreatePlan,
} from "../workflows/containers";
import {
  buildMaterializedDocumentCreatePlan,
  persistedDocumentCreateStateFromResponse,
  resolveDocumentCreateAuthor,
} from "../workflows/documents";
import {
  createInitialRootMetadataBootstrap,
  type InitialRootMetadataBootstrap,
  persistRegistrationBootstrap,
} from "../workflows/registration";

interface RegisterCurrentIdentityResult {
  canRegisterCurrentIdentity: boolean;
  registerCurrentIdentity: () => Promise<boolean>;
}

type InitialRootMetadataDocument = Awaited<
  ReturnType<typeof buildMaterializedDocumentCreatePlan>
>;

async function createInitialOrganizationPolicy(input: {
  encapsulationPublicKey: Uint8Array;
  organizationId: string;
  signingPrivateKey: Uint8Array;
  signingPublicKey: Uint8Array;
  userId: string;
}): Promise<RegistrationRequest["initialOrganizationPolicy"]> {
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
    await buildPrincipalStateSigningInput({
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
    }),
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
      cipherSuite: "aes-256-gcm",
      ciphertext: payloadCiphertext,
      ciphertextHash: state.payloadCiphertextHash,
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

async function persistLocalRegistrationState(
  dbClient: ReturnType<typeof useDatabase>["client"],
  containerId: string,
  encapsulationPublicKey: Uint8Array,
  response: RegistrationResponse,
  bootstrap: InitialRootMetadataBootstrap,
  rootMetadataDocument: InitialRootMetadataDocument,
  log: (message: string) => void,
) {
  if (!dbClient) {
    return;
  }

  try {
    await persistRegistrationBootstrap(dbClient, {
      containerId,
      encapsulationPublicKey,
      organizationId: response.organizationId,
      rootMetadataAccessEpoch: response.rootMetadataAccessEpoch,
      rootMetadataAccessStateHash: response.rootMetadataAccessStateHash,
      rootMetadataDocumentId: response.rootMetadataDocumentId,
      rootMetadataInitialUpdate: bootstrap.initialUpdate,
      rootMetadataSnapshot: bytesToBase64(bootstrap.initialUpdate),
      rootMetadataState: persistedDocumentCreateStateFromResponse(
        rootMetadataDocument.plan,
        response.rootMetadataDocument,
      ),
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
  input.log("Registering identity...");

  const bootstrap = await createInitialRootMetadataBootstrap(input.containerId);
  const newUserId = crypto.randomUUID();
  const organizationId = crypto.randomUUID();
  const initialOrganizationPolicy = await createInitialOrganizationPolicy({
    encapsulationPublicKey: input.encapsulationKeyPair.publicKey,
    organizationId,
    signingPrivateKey: input.signingKeyPair.signingPrivateKey,
    signingPublicKey: input.signingKeyPair.signingPublicKey,
    userId: newUserId,
  });
  const signingFingerprint = await toFingerprint(
    input.signingKeyPair.signingPublicKey,
  );
  const author = resolveDocumentCreateAuthor({
    organizationId,
    signingFingerprint,
    signingKeyPair: input.signingKeyPair,
    userId: newUserId,
  });
  if (!author) {
    throw new Error(
      `Registration document author context is unavailable for user ${newUserId} in organization ${organizationId}.`,
    );
  }

  const rootContainer = await buildRootContainerCreatePlan({
    author,
    containerId: input.containerId,
    metadataDocumentId: bootstrap.metadataDocumentId,
    recipientEncapsulationPublicKey: input.encapsulationKeyPair.publicKey,
  });
  const rootMetadataDocument = await buildMaterializedDocumentCreatePlan({
    author,
    containerProjection: rootContainerWriterProjectionFromCreatePlan(
      rootContainer.plan,
    ),
    documentId: bootstrap.metadataDocumentId,
    targetSecretKey: input.encapsulationKeyPair.secretKey,
    trustedLocalProjection: true,
  });

  const response = await input.apiClient.registerUser(
    newUserId,
    organizationId,
    input.containerId,
    input.signingKeyPair.signingPublicKey,
    input.encapsulationKeyPair.publicKey,
    initialOrganizationPolicy,
    rootContainer.plan.request,
    rootMetadataDocument.plan.request,
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
    rootMetadataDocument,
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
