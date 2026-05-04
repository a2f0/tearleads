import { bytesToBase64 } from "@tearleads/encoding";
import { createPendingUpdateFields } from "../../data/documentSync";
import { getAppDatabaseRuntime } from "../../data/persistence/appDatabaseRuntime";
import { sqlContactsPersistence } from "../../data/persistence/contacts/contactsPersistence";
import type { DocumentRecord } from "../../data/persistence/documentPersistence";
import { sqlExplorerPersistence } from "../../data/persistence/explorer/explorerPersistence";
import { addressBookProjection } from "../../data/persistence/schema";
import {
  type ExecSql,
  runSerializedSqlMutation,
} from "../../data/persistence/sqlSchema";

interface RegistrationBootstrapInput {
  containerId: string;
  encapsulationPublicKey: Uint8Array;
  rootMetadataAccessEpoch: number;
  rootMetadataAccessStateHash: string;
  rootMetadataDocumentId: string;
  rootMetadataInitialUpdate: Uint8Array;
  rootMetadataSnapshot: string;
  rootMetadataState: Pick<
    DocumentRecord,
    | "documentId"
    | "contentKeyBundle"
    | "documentKekTargets"
    | "documentManifestBundle"
  >;
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
    await sqlExplorerPersistence.ensureSchema(lockedExecSql);
    await sqlContactsPersistence.ensureSchema(lockedExecSql);
    const rootRecord: DocumentRecord = {
      accessEpoch: input.rootMetadataAccessEpoch,
      accessStateHash: input.rootMetadataAccessStateHash,
      documentId: input.rootMetadataDocumentId,
      id: input.containerId,
      lastCommitLsn: null,
      loroSnapshot: input.rootMetadataSnapshot,
      contentKeyBundle: input.rootMetadataState.contentKeyBundle ?? null,
      documentKekTargets: input.rootMetadataState.documentKekTargets ?? null,
      documentManifestBundle:
        input.rootMetadataState.documentManifestBundle ?? null,
    };
    await sqlExplorerPersistence.saveContainer(
      lockedExecSql,
      {
        id: input.containerId,
        organizationId: input.organizationId,
        parentId: null,
        metadataDocumentId: input.rootMetadataDocumentId,
        name: "/",
        icon: null,
      },
      rootRecord,
    );
    const initialMetadataUpdate = createPendingUpdateFields(
      input.rootMetadataInitialUpdate,
    );
    if (initialMetadataUpdate) {
      await sqlExplorerPersistence.enqueuePendingUpdate(lockedExecSql, {
        containerId: input.containerId,
        ...initialMetadataUpdate,
      });
    }
    const updatedAt = new Date().toISOString();
    const projectionRow = {
      addressBookId: DEFAULT_ADDRESS_BOOK_ID,
      userId: input.userId,
      encapsulationPublicKey: bytesToBase64(input.encapsulationPublicKey),
      isSelf: 1,
      updatedAt,
    };
    const { db } = getAppDatabaseRuntime(lockedExecSql);
    await db
      .insert(addressBookProjection)
      .values(projectionRow)
      .onConflictDoUpdate({
        target: [
          addressBookProjection.addressBookId,
          addressBookProjection.userId,
        ],
        set: {
          encapsulationPublicKey: projectionRow.encapsulationPublicKey,
          isSelf: 1,
          updatedAt,
        },
      })
      .run();
  });
}
