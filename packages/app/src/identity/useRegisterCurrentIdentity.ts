import { wrapDekForRecipients } from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
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

    log("Uploading public key...");

    const recipients = await wrapDekForRecipients(
      crypto.getRandomValues(new Uint8Array(32)),
      [encapsulationKeyPair.publicKey],
    );
    const wrappedEnvelope = recipients[0];

    if (wrappedEnvelope === undefined) {
      return false;
    }

    const bootstrap = await createInitialRootMetadataBootstrap(
      containerId,
      encapsulationKeyPair.publicKey,
    );

    const response = await apiClient.postPublicKey(
      containerId,
      signingKeyPair.signingPublicKey,
      encapsulationKeyPair.publicKey,
      wrappedEnvelope,
      bootstrap.initialRootMetadataUpdates,
      bootstrap.rootMetadataRecipientEnvelopes,
    );
    if (!response) {
      return false;
    }

    log(`Key registered (${response.userId})`);
    setUserId(response.userId);
    setOrganizationId(response.organizationId);
    await persistLocalRegistrationState(
      dbClient,
      containerId,
      encapsulationKeyPair.publicKey,
      response,
      bootstrap,
      log,
    );

    await loginWithChallenge(response.challenge);
    return true;
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
