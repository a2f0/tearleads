import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { createPendingUpdateFields } from "../../data/documentSync";
import { sqlContainerContentsPersistence } from "../../data/persistence/container-contents/containerContentsPersistence";
import { savePrincipalPolicyBundle } from "../../data/persistence/principalPolicyPersistence";
import type { DocumentRecord } from "../../data/sqlite/documentPersistence";
import {
  createExecSql,
  type ExecSql,
  type ExecSqlClientLike,
  runSerializedSqlMutation,
} from "../../data/sqlite/sqlSchema";

interface RegistrationBootstrapInput {
  containerId: string;
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

/**
 * Persists the local root-container bootstrap created during successful
 * registration so container contents can initialize from SQLite on first login.
 */
async function persistRegistrationBootstrapFromExecSql(
  execSql: ExecSql,
  input: RegistrationBootstrapInput,
): Promise<void> {
  await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
    await sqlContainerContentsPersistence.ensureSchema(lockedExecSql);
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
  });
}

export async function persistRegistrationBootstrap(
  client: ExecSqlClientLike,
  input: RegistrationBootstrapInput,
): Promise<void> {
  await persistRegistrationBootstrapFromExecSql(createExecSql(client), input);
}
