import { wrapDekForRecipients } from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { useApiClient } from "../../api/ApiClientProvider";
import { useCryptoSession } from "../../crypto/CryptoSessionProvider";
import type { SqlRow, SqlRowValue } from "../../data/AppDataProvider";
import {
  ensureContainerTables,
  saveContainer,
} from "../../data/containerPersistence";
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
    generateKey,
    destroyKey,
    setUserId,
    setOrganizationId,
    setContainerId,
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
      {signingKeyPair && encapsulationKeyPair && !userId && (
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

            const response = await apiClient.postPublicKey(
              signingKeyPair.signingPublicKey,
              encapsulationKeyPair.publicKey,
              wrappedEnvelope,
            );
            if (!response) return;

            log(`Key registered (${response.userId})`);
            setUserId(response.userId);
            setOrganizationId(response.organizationId);
            setContainerId(response.containerId);

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
                await ensureContainerTables(execSql);
                await saveContainer(execSql, {
                  id: response.containerId,
                  organizationId: response.organizationId,
                  parentId: null,
                  name: "/",
                });
                await execSql(`
                  CREATE TABLE IF NOT EXISTS address_book_projection (
                    address_book_id TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    encapsulation_public_key TEXT NOT NULL,
                    is_self INTEGER NOT NULL DEFAULT 0,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (address_book_id, user_id)
                  )
                `);
                await execSql(
                  `
                    INSERT INTO address_book_projection (
                      address_book_id, user_id, encapsulation_public_key, is_self, updated_at
                    )
                    VALUES (:addressBookId, :userId, :encapsulationPublicKey, 1, :updatedAt)
                    ON CONFLICT(address_book_id, user_id) DO UPDATE SET
                      encapsulation_public_key = excluded.encapsulation_public_key,
                      is_self = 1,
                      updated_at = excluded.updated_at
                  `,
                  {
                    ":addressBookId": "default",
                    ":userId": response.userId,
                    ":encapsulationPublicKey": bytesToBase64(
                      encapsulationKeyPair.publicKey,
                    ),
                    ":updatedAt": new Date().toISOString(),
                  },
                );
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
