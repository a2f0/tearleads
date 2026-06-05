import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { createPendingUpdateFields } from "../../data/documentSync";
import { sqlContainerContentsPersistence } from "../../data/persistence/container-contents/containerContentsPersistence";
import {
  type StoredDocumentRecord,
  sqlDocumentsPersistence,
} from "../../data/persistence/documents/documentsPersistence";
import { savePrincipalPolicyBundle } from "../../data/persistence/principalPolicyPersistence";
import type { DocumentRecord } from "../../data/sqlite/documentPersistence";
import {
  createExecSql,
  type ExecSql,
  type ExecSqlClientLike,
  runSerializedSqlMutation,
} from "../../data/sqlite/sqlSchema";
import { ORGANIZATION_PROFILE_DOCUMENT_KIND } from "../organizations/organizationProfile";
import { ORGANIZATION_ROSTER_PROFILE_CONTAINER_NAME } from "../organizations/rosterProfileContainer";

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
  rosterProfileContainer?: {
    accessEpoch: number;
    accessStateHash: string;
    containerId: string;
    createdAt: string;
    metadataDocumentId: string;
    metadataInitialUpdate: Uint8Array;
    metadataSnapshot: string;
    metadataState: Pick<
      DocumentRecord,
      | "documentId"
      | "contentKeyBundle"
      | "documentKekTargets"
      | "documentManifestBundle"
    >;
    systemSlot: ContainerSystemSlot;
    updatedAt: string;
  };
  organizationProfileDocument?: {
    accessEpoch: number;
    accessStateHash: string;
    containerId: string;
    documentId: string;
    documentState: Pick<
      DocumentRecord,
      | "documentId"
      | "contentKeyBundle"
      | "documentKekTargets"
      | "documentManifestBundle"
    >;
    initialUpdate: Uint8Array;
    localId: string;
    snapshot: string;
  };
  organizationId: string;
  userId: string;
}

async function enqueueInitialContainerMetadataUpdate(
  execSql: ExecSql,
  input: {
    containerId: string;
    initialUpdate: Uint8Array;
  },
): Promise<void> {
  const initialMetadataUpdate = createPendingUpdateFields(input.initialUpdate);
  if (!initialMetadataUpdate) {
    return;
  }

  await sqlContainerContentsPersistence.enqueuePendingUpdate(execSql, {
    containerId: input.containerId,
    ...initialMetadataUpdate,
  });
}

async function persistRootContainerBootstrap(
  execSql: ExecSql,
  input: RegistrationBootstrapInput,
): Promise<void> {
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
    execSql,
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
  await enqueueInitialContainerMetadataUpdate(execSql, {
    containerId: input.containerId,
    initialUpdate: input.rootMetadataInitialUpdate,
  });
}

async function persistRosterProfileContainerBootstrap(
  execSql: ExecSql,
  input: RegistrationBootstrapInput,
): Promise<void> {
  const rosterProfileContainer = input.rosterProfileContainer;
  if (!rosterProfileContainer) {
    return;
  }

  const metadataState = rosterProfileContainer.metadataState ?? null;
  const rosterProfileRecord: DocumentRecord = {
    accessEpoch: rosterProfileContainer.accessEpoch,
    accessStateHash: rosterProfileContainer.accessStateHash,
    documentId: rosterProfileContainer.metadataDocumentId,
    id: rosterProfileContainer.containerId,
    lastCommitLsn: null,
    loroSnapshot: rosterProfileContainer.metadataSnapshot,
    contentKeyBundle: metadataState?.contentKeyBundle ?? null,
    documentKekTargets: metadataState?.documentKekTargets ?? null,
    documentManifestBundle: metadataState?.documentManifestBundle ?? null,
  };
  await sqlContainerContentsPersistence.saveContainer(
    execSql,
    {
      id: rosterProfileContainer.containerId,
      organizationId: input.organizationId,
      parentId: input.containerId,
      metadataDocumentId: rosterProfileContainer.metadataDocumentId,
      systemSlot: rosterProfileContainer.systemSlot,
      name: ORGANIZATION_ROSTER_PROFILE_CONTAINER_NAME,
      icon: null,
    },
    rosterProfileRecord,
    {
      serverTimestamps: {
        createdAt: rosterProfileContainer.createdAt,
        updatedAt: rosterProfileContainer.updatedAt,
      },
    },
  );
  await enqueueInitialContainerMetadataUpdate(execSql, {
    containerId: rosterProfileContainer.containerId,
    initialUpdate: rosterProfileContainer.metadataInitialUpdate,
  });
}

async function persistOrganizationProfileDocumentBootstrap(
  execSql: ExecSql,
  input: RegistrationBootstrapInput,
): Promise<void> {
  const organizationProfileDocument = input.organizationProfileDocument;
  if (!organizationProfileDocument) {
    return;
  }

  const initialUpdate = createPendingUpdateFields(
    organizationProfileDocument.initialUpdate,
  );
  const documentState = organizationProfileDocument.documentState;
  const document: StoredDocumentRecord = {
    accessEpoch: organizationProfileDocument.accessEpoch,
    accessStateHash: organizationProfileDocument.accessStateHash,
    containerId: organizationProfileDocument.containerId,
    documentId: organizationProfileDocument.documentId,
    documentKind: ORGANIZATION_PROFILE_DOCUMENT_KIND,
    id: organizationProfileDocument.localId,
    lastCommitLsn: null,
    loroSnapshot: organizationProfileDocument.snapshot,
    text: "",
    title: "Organization Profile",
    contentKeyBundle: documentState.contentKeyBundle ?? null,
    documentKekTargets: documentState.documentKekTargets ?? null,
    documentManifestBundle: documentState.documentManifestBundle ?? null,
  };

  await sqlDocumentsPersistence.saveDocument(execSql, document);
  if (initialUpdate) {
    await sqlDocumentsPersistence.enqueuePendingUpdate(execSql, {
      localId: organizationProfileDocument.localId,
      ...initialUpdate,
    });
  }
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
    await sqlDocumentsPersistence.ensureSchema(lockedExecSql);
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
    await persistRootContainerBootstrap(lockedExecSql, input);
    await persistRosterProfileContainerBootstrap(lockedExecSql, input);
    await persistOrganizationProfileDocumentBootstrap(lockedExecSql, input);
  });
}

export async function persistRegistrationBootstrap(
  client: ExecSqlClientLike,
  input: RegistrationBootstrapInput,
): Promise<void> {
  await persistRegistrationBootstrapFromExecSql(createExecSql(client), input);
}
