import { bytesToBase64 } from "@tearleads/encoding";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { createPendingUpdateFields } from "../../data/documentSync";
import { sqlContactsPersistence } from "../../data/persistence/contacts/contactsPersistence";
import { sqlContainerContentsPersistence } from "../../data/persistence/container-contents/containerContentsPersistence";
import { savePrincipalPolicyBundle } from "../../data/persistence/principalPolicyPersistence";
import type { DocumentRecord } from "../../data/sqlite/documentPersistence";
import { addressBookProjection } from "../../data/sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../data/sqlite/sqlitePersistenceRuntime";
import {
  createExecSql,
  type ExecSql,
  type ExecSqlClientLike,
  runSerializedSqlMutation,
} from "../../data/sqlite/sqlSchema";

interface RegistrationBootstrapInput {
  containerId: string;
  encapsulationPublicKey: Uint8Array;
  initialAdminGroupPolicy: PrincipalPolicyBundleResponse;
  initialMemberGroupPolicy: PrincipalPolicyBundleResponse;
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
 * successful registration so the container contents and contacts workflows can
 * initialize from SQLite on first login.
 */
async function persistRegistrationBootstrapFromExecSql(
  execSql: ExecSql,
  input: RegistrationBootstrapInput,
): Promise<void> {
  await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
    await sqlContainerContentsPersistence.ensureSchema(lockedExecSql);
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
    await sqlContainerContentsPersistence.saveContainer(
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
      await sqlContainerContentsPersistence.enqueuePendingUpdate(
        lockedExecSql,
        {
          containerId: input.containerId,
          ...initialMetadataUpdate,
        },
      );
    }
    const updatedAt = new Date().toISOString();
    await savePrincipalPolicyBundle(
      lockedExecSql,
      input.initialAdminGroupPolicy,
      updatedAt,
    );
    await savePrincipalPolicyBundle(
      lockedExecSql,
      input.initialMemberGroupPolicy,
      updatedAt,
    );
    const projectionRow = {
      addressBookId: DEFAULT_ADDRESS_BOOK_ID,
      contactId: input.userId,
      firstName: "",
      lastName: "",
      userId: input.userId,
      encapsulationPublicKey: bytesToBase64(input.encapsulationPublicKey),
      isSelf: 1,
      updatedAt,
    };
    const { db } = getClientSQLitePersistenceRuntime(lockedExecSql);
    await db
      .insert(addressBookProjection)
      .values(projectionRow)
      .onConflictDoUpdate({
        target: [
          addressBookProjection.addressBookId,
          addressBookProjection.contactId,
        ],
        set: {
          firstName: projectionRow.firstName,
          lastName: projectionRow.lastName,
          userId: projectionRow.userId,
          encapsulationPublicKey: projectionRow.encapsulationPublicKey,
          isSelf: 1,
          updatedAt,
        },
      })
      .run();
  });
}

export async function persistRegistrationBootstrap(
  client: ExecSqlClientLike,
  input: RegistrationBootstrapInput,
): Promise<void> {
  await persistRegistrationBootstrapFromExecSql(createExecSql(client), input);
}
