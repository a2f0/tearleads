import { wrapDekForRecipients } from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { useApiClient } from "../../api/ApiClientProvider";
import { useCryptoSession } from "../../crypto/CryptoSessionProvider";
import { createInitializedContainerMetadataDocument } from "../../data/containerMetadataDocument";
import {
  createPendingUpdateFields,
  encryptPendingUpdates,
  getLocalRecipientPublicKeys,
} from "../../data/documentSync";
import { persistRegistrationBootstrap } from "../../data/registrationBootstrapPersistence";
import type { SqlRow, SqlRowValue } from "../../data/sqlSchema";
import { useDatabase } from "../../db/DatabaseProvider";
import { useLog } from "../../logging/LogProvider";
import { Menu, type MenuPosition } from "./Menu";
import { MenuItem } from "./MenuItem";

export function PaneMenu({
  position,
  onClose,
}: {
  position: MenuPosition;
  onClose: () => void;
}) {
  const { client: dbClient, killWorker, spawnWorker, status } = useDatabase();
  const {
    signingKeyPair,
    encapsulationKeyPair,
    userId,
    containerId,
    generateKey,
    destroyKey,
    setUserId,
    setOrganizationId,
    loginWithChallenge,
  } = useCryptoSession();
  const { log } = useLog();
  const apiClient = useApiClient();
  const isTerminated = status === "terminated";

  return (
    <Menu position={position} onClose={onClose}>
      {!isTerminated && (
        <MenuItem
          label="Kill Worker"
          onClick={() => {
            killWorker();
            onClose();
          }}
        />
      )}
      {isTerminated && (
        <MenuItem
          label="Spawn Worker"
          onClick={() => {
            spawnWorker();
            onClose();
          }}
        />
      )}
      {!signingKeyPair && (
        <MenuItem
          label="Generate Key Pair"
          onClick={() => {
            generateKey();
            onClose();
          }}
        />
      )}
      {signingKeyPair && (
        <MenuItem
          label="Destroy Key Pair"
          onClick={() => {
            destroyKey();
            onClose();
          }}
        />
      )}
      {signingKeyPair && encapsulationKeyPair && !userId && containerId && (
        <MenuItem
          label="Upload Public Key"
          onClick={async () => {
            onClose();
            log("Uploading public key...");

            const dek = crypto.getRandomValues(new Uint8Array(32));
            const recipients = await wrapDekForRecipients(dek, [
              encapsulationKeyPair.publicKey,
            ]);
            const wrappedEnvelope = recipients[0];

            if (!wrappedEnvelope) return;

            const { initialUpdate } =
              await createInitializedContainerMetadataDocument(containerId, {
                icon: null,
                name: "/",
              });
            const pendingUpdateFields =
              createPendingUpdateFields(initialUpdate);
            const initialRootMetadataUpdates = pendingUpdateFields
              ? await encryptPendingUpdates(
                  [
                    {
                      id: crypto.randomUUID(),
                      ...pendingUpdateFields,
                    },
                  ],
                  getLocalRecipientPublicKeys(encapsulationKeyPair),
                )
              : [];

            const response = await apiClient.postPublicKey(
              containerId,
              signingKeyPair.signingPublicKey,
              encapsulationKeyPair.publicKey,
              wrappedEnvelope,
              initialRootMetadataUpdates,
            );
            if (!response) return;

            log(`Key registered (${response.userId})`);
            setUserId(response.userId);
            setOrganizationId(response.organizationId);

            if (dbClient) {
              const execSql = async (
                sql: string,
                bind?: Record<string, SqlRowValue>,
              ): Promise<SqlRow[]> => {
                const result = await dbClient.exec(
                  bind ? { sql, bind } : { sql },
                );
                return result.rows;
              };

              try {
                await persistRegistrationBootstrap(execSql, {
                  containerId,
                  encapsulationPublicKey: encapsulationKeyPair.publicKey,
                  organizationId: response.organizationId,
                  rootMetadataAccessEpoch: response.rootMetadataAccessEpoch,
                  rootMetadataDocumentId: response.rootMetadataDocumentId,
                  rootMetadataSnapshot: bytesToBase64(initialUpdate),
                  userId: response.userId,
                });
                log("Local identity and root container persisted");
              } catch (error: unknown) {
                console.error("Failed to persist registration data:", error);
              }
            }

            await loginWithChallenge(response.challenge);
          }}
        />
      )}
    </Menu>
  );
}
