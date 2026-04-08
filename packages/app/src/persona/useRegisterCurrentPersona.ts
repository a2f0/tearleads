import { wrapDekForRecipients } from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { useCallback } from "react";
import { useApiClient } from "../api/ApiClientProvider";
import { useCryptoSession } from "../crypto/CryptoSessionProvider";
import { createInitializedContainerMetadataDocument } from "../data/containerMetadataDocument";
import {
  createDocumentEncryptionMaterial,
  createPendingUpdateFields,
  encryptPendingUpdates,
} from "../data/documentSync";
import { persistRegistrationBootstrap } from "../data/registrationBootstrapPersistence";
import type { SqlRow, SqlRowValue } from "../data/sqlSchema";
import { useDatabase } from "../db/DatabaseProvider";
import { useLog } from "../logging/LogProvider";
import { usePersona } from "./PersonaProvider";

interface RegisterCurrentPersonaResult {
  canRegisterCurrentPersona: boolean;
  registerCurrentPersona: () => Promise<boolean>;
}

export function useRegisterCurrentPersona(): RegisterCurrentPersonaResult {
  const { client: dbClient } = useDatabase();
  const {
    userId,
    containerId,
    setUserId,
    setOrganizationId,
    loginWithChallenge,
  } = useCryptoSession();
  const { encapsulationKeyPair, signingKeyPair } = usePersona();
  const { log } = useLog();
  const apiClient = useApiClient();

  const canRegisterCurrentPersona =
    signingKeyPair !== null &&
    encapsulationKeyPair !== null &&
    userId === null &&
    containerId !== null;

  const registerCurrentPersona = useCallback(async (): Promise<boolean> => {
    if (
      signingKeyPair === null ||
      encapsulationKeyPair === null ||
      userId !== null ||
      containerId === null
    ) {
      return false;
    }

    log("Uploading public key...");

    const dek = crypto.getRandomValues(new Uint8Array(32));
    const recipients = await wrapDekForRecipients(dek, [
      encapsulationKeyPair.publicKey,
    ]);
    const wrappedEnvelope = recipients[0];

    if (wrappedEnvelope === undefined) {
      return false;
    }

    const { initialUpdate } = await createInitializedContainerMetadataDocument(
      containerId,
      {
        icon: null,
        name: "/",
      },
    );
    const initialMetadataDocumentEncryption =
      await createDocumentEncryptionMaterial([encapsulationKeyPair.publicKey]);
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

    const response = await apiClient.postPublicKey(
      containerId,
      signingKeyPair.signingPublicKey,
      encapsulationKeyPair.publicKey,
      wrappedEnvelope,
      initialRootMetadataUpdates,
      initialMetadataDocumentEncryption.documentRecipientEnvelopes,
    );
    if (!response) {
      return false;
    }

    log(`Key registered (${response.userId})`);
    setUserId(response.userId);
    setOrganizationId(response.organizationId);

    if (dbClient) {
      const execSql = async (
        sql: string,
        bind?: Record<string, SqlRowValue>,
      ): Promise<SqlRow[]> => {
        const result = await dbClient.exec(bind ? { sql, bind } : { sql });
        return result.rows;
      };

      try {
        await persistRegistrationBootstrap(execSql, {
          containerId,
          encapsulationPublicKey: encapsulationKeyPair.publicKey,
          organizationId: response.organizationId,
          rootMetadataAccessEpoch: response.rootMetadataAccessEpoch,
          rootMetadataDocumentId: response.rootMetadataDocumentId,
          rootMetadataRecipientEnvelopes:
            initialMetadataDocumentEncryption.documentRecipientEnvelopes,
          rootMetadataSnapshot: bytesToBase64(initialUpdate),
          userId: response.userId,
        });
        log("Local identity and root container persisted");
      } catch (error: unknown) {
        console.error("Failed to persist registration data:", error);
      }
    }

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

  return { canRegisterCurrentPersona, registerCurrentPersona };
}
