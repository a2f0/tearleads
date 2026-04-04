import { bytesToBase64 } from "@tearleads/encoding";
import { sqlContactsPersistence } from "../mini-apps/contacts/contactsPersistence";
import { ensureContainerTables, saveContainer } from "./containerPersistence";
import { type ExecSql, runSerializedSqlMutation } from "./sqlSchema";

interface RegistrationBootstrapInput {
  containerId: string;
  encapsulationPublicKey: Uint8Array;
  organizationId: string;
  userId: string;
}

const DEFAULT_ADDRESS_BOOK_ID = "default";

/**
 * Persists the local root-container and self-contact bootstrap created during
 * successful registration so the explorer and contacts apps can initialize
 * from SQLite on first login.
 */
export async function persistRegistrationBootstrap(
  execSql: ExecSql,
  input: RegistrationBootstrapInput,
): Promise<void> {
  await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
    await ensureContainerTables(lockedExecSql);
    await sqlContactsPersistence.ensureSchema(lockedExecSql);
    await saveContainer(lockedExecSql, {
      id: input.containerId,
      organizationId: input.organizationId,
      parentId: null,
      name: "/",
    });
    await lockedExecSql(
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
        ":addressBookId": DEFAULT_ADDRESS_BOOK_ID,
        ":userId": input.userId,
        ":encapsulationPublicKey": bytesToBase64(input.encapsulationPublicKey),
        ":updatedAt": new Date().toISOString(),
      },
    );
  });
}
