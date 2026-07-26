import { bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument,
  encodeVersionVector,
  exportFullHistorySnapshot,
  importUpdates,
} from "@tearleads/loro";
import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { getScopedPeerSeed } from "../../data/crdtPeerSeed";
import { createPendingUpdateFields } from "../../data/documentSync";
import type { DocumentProjectorRegistryInput } from "../../data/documents/documentKinds";
import { sqlContainerContentsPersistence } from "../../data/persistence/container-contents/containerContentsPersistence";
import {
  DOCUMENTS_APP_KIND,
  type StoredDocumentRecord,
  sqlDocumentsPersistence,
} from "../../data/persistence/documents/documentsPersistence";
import {
  advanceLocallyAcknowledgedAccessManifestHeadsAtomically,
  type LocallyAcknowledgedAccessManifestHead,
} from "../../data/persistence/locallyAcknowledgedCheckpointPersistence";
import type { DocumentRecord } from "../../data/sqlite/documentPersistence";
import {
  createExecSql,
  type ExecSql,
  type ExecSqlClientLike,
  runSerializedSqlMutation,
} from "../../data/sqlite/sqlSchema";
import { persistDocumentState } from "../documents/persistence";
import { ORGANIZATION_PROFILE_DOCUMENT_KIND } from "../organizations/organizationProfile";
import {
  ORGANIZATION_METADATA_CONTAINER_NAME,
  ORGANIZATION_ROSTER_PROFILE_CONTAINER_NAME,
  ROSTER_PROFILE_DOCUMENT_KIND,
} from "../organizations/rosterProfileContainer";
import { enqueueInitialContainerMetadataUpdate } from "./registrationBootstrapPendingUpdates";
import { persistRegistrationPrincipalPolicies } from "./registrationPrincipalPolicyPersistence";

export interface RegistrationBootstrapInput {
  acknowledgedAccessHeads: readonly LocallyAcknowledgedAccessManifestHead[];
  containerId: string;
  initialAdminGroupPolicy: PrincipalPolicyBundleResponse;
  initialMemberGroupPolicy: PrincipalPolicyBundleResponse;
  initialOrganizationPolicy: PrincipalPolicyBundleResponse;
  rootMetadataAccessEpoch: number;
  rootMetadataAccessStateHash: string;
  rootContainerServerTimestamp: string;
  rootMetadataDocumentId: string;
  rootMetadataInitialUpdate: Uint8Array;
  rootMetadataInitialUpdateCommitted?: boolean | undefined;
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
    metadataInitialUpdateCommitted?: boolean | undefined;
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
  organizationMetadataContainer?: {
    accessEpoch: number;
    accessStateHash: string;
    containerId: string;
    createdAt: string;
    metadataDocumentId: string;
    metadataInitialUpdate: Uint8Array;
    metadataInitialUpdateCommitted?: boolean | undefined;
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
    initialUpdateCommitted: boolean;
    localId: string;
    snapshot: string;
  };
  rosterProfileDocument?: {
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
    initialUpdateCommitted: boolean;
    localId: string;
  };
  // Additional app-owned system containers provisioned with the organization
  // (e.g. a trash bin). Each carries its own display name and icon (unlike the
  // roster/organization-metadata containers, whose names are fixed), since the
  // caller declares them.
  systemContainers?: Array<{
    accessEpoch: number;
    accessStateHash: string;
    containerId: string;
    createdAt: string;
    icon: string | null;
    metadataDocumentId: string;
    metadataSnapshot: string;
    metadataState: Pick<
      DocumentRecord,
      | "documentId"
      | "contentKeyBundle"
      | "documentKekTargets"
      | "documentManifestBundle"
    >;
    name: string;
    systemSlot: ContainerSystemSlot;
    updatedAt: string;
  }>;
  documentProjectors?: DocumentProjectorRegistryInput | undefined;
  organizationId: string;
  userId: string;
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
      effectiveAccessLevel: "admin",
      organizationId: input.organizationId,
      parentId: null,
      metadataDocumentId: input.rootMetadataDocumentId,
      name: "/",
      icon: null,
    },
    rootRecord,
    {
      localUpdatedAt: input.rootContainerServerTimestamp,
      serverTimestamps: {
        createdAt: input.rootContainerServerTimestamp,
        updatedAt: input.rootContainerServerTimestamp,
      },
    },
  );
  await enqueueInitialContainerMetadataUpdate(
    execSql,
    input.containerId,
    input.rootMetadataInitialUpdate,
    input.rootMetadataInitialUpdateCommitted,
  );
}

async function persistRosterProfileContainerBootstrap(
  execSql: ExecSql,
  input: RegistrationBootstrapInput,
): Promise<void> {
  const rosterProfileContainer = input.rosterProfileContainer;
  if (!rosterProfileContainer) {
    return;
  }

  const metadataState = rosterProfileContainer.metadataState;
  const rosterProfileRecord: DocumentRecord = {
    accessEpoch: rosterProfileContainer.accessEpoch,
    accessStateHash: rosterProfileContainer.accessStateHash,
    documentId: rosterProfileContainer.metadataDocumentId,
    id: rosterProfileContainer.containerId,
    lastCommitLsn: null,
    loroSnapshot: rosterProfileContainer.metadataSnapshot,
    contentKeyBundle: metadataState.contentKeyBundle ?? null,
    documentKekTargets: metadataState.documentKekTargets ?? null,
    documentManifestBundle: metadataState.documentManifestBundle ?? null,
  };
  await sqlContainerContentsPersistence.saveContainer(
    execSql,
    {
      id: rosterProfileContainer.containerId,
      effectiveAccessLevel: "admin",
      organizationId: input.organizationId,
      parentId: input.containerId,
      metadataDocumentId: rosterProfileContainer.metadataDocumentId,
      systemSlot: rosterProfileContainer.systemSlot,
      name: ORGANIZATION_ROSTER_PROFILE_CONTAINER_NAME,
      icon: null,
    },
    rosterProfileRecord,
    {
      localUpdatedAt: rosterProfileContainer.updatedAt,
      serverTimestamps: {
        createdAt: rosterProfileContainer.createdAt,
        updatedAt: rosterProfileContainer.updatedAt,
      },
    },
  );
  await enqueueInitialContainerMetadataUpdate(
    execSql,
    rosterProfileContainer.containerId,
    rosterProfileContainer.metadataInitialUpdate,
    rosterProfileContainer.metadataInitialUpdateCommitted,
  );
}

async function persistOrganizationMetadataContainerBootstrap(
  execSql: ExecSql,
  input: RegistrationBootstrapInput,
): Promise<void> {
  const organizationMetadataContainer = input.organizationMetadataContainer;
  if (!organizationMetadataContainer) {
    return;
  }

  const metadataState = organizationMetadataContainer.metadataState;
  const metadataRecord: DocumentRecord = {
    accessEpoch: organizationMetadataContainer.accessEpoch,
    accessStateHash: organizationMetadataContainer.accessStateHash,
    documentId: organizationMetadataContainer.metadataDocumentId,
    id: organizationMetadataContainer.containerId,
    lastCommitLsn: null,
    loroSnapshot: organizationMetadataContainer.metadataSnapshot,
    contentKeyBundle: metadataState.contentKeyBundle ?? null,
    documentKekTargets: metadataState.documentKekTargets ?? null,
    documentManifestBundle: metadataState.documentManifestBundle ?? null,
  };
  await sqlContainerContentsPersistence.saveContainer(
    execSql,
    {
      id: organizationMetadataContainer.containerId,
      // The founder persisting at provisioning reaches this container as an
      // admin via root inheritance; a Members-only member syncing it later
      // derives their own read-level access from the group grant.
      effectiveAccessLevel: "admin",
      organizationId: input.organizationId,
      parentId: input.containerId,
      metadataDocumentId: organizationMetadataContainer.metadataDocumentId,
      systemSlot: organizationMetadataContainer.systemSlot,
      name: ORGANIZATION_METADATA_CONTAINER_NAME,
      icon: null,
    },
    metadataRecord,
    {
      localUpdatedAt: organizationMetadataContainer.updatedAt,
      serverTimestamps: {
        createdAt: organizationMetadataContainer.createdAt,
        updatedAt: organizationMetadataContainer.updatedAt,
      },
    },
  );
  await enqueueInitialContainerMetadataUpdate(
    execSql,
    organizationMetadataContainer.containerId,
    organizationMetadataContainer.metadataInitialUpdate,
    organizationMetadataContainer.metadataInitialUpdateCommitted,
  );
}

async function persistSystemContainersBootstrap(
  execSql: ExecSql,
  input: RegistrationBootstrapInput,
): Promise<void> {
  const systemContainers = input.systemContainers;
  if (!systemContainers) {
    return;
  }

  for (const systemContainer of systemContainers) {
    const metadataState = systemContainer.metadataState;
    const record: DocumentRecord = {
      accessEpoch: systemContainer.accessEpoch,
      accessStateHash: systemContainer.accessStateHash,
      documentId: systemContainer.metadataDocumentId,
      id: systemContainer.containerId,
      lastCommitLsn: null,
      loroSnapshot: systemContainer.metadataSnapshot,
      contentKeyBundle: metadataState.contentKeyBundle ?? null,
      documentKekTargets: metadataState.documentKekTargets ?? null,
      documentManifestBundle: metadataState.documentManifestBundle ?? null,
    };
    await sqlContainerContentsPersistence.saveContainer(
      execSql,
      {
        id: systemContainer.containerId,
        effectiveAccessLevel: "admin",
        organizationId: input.organizationId,
        parentId: input.containerId,
        metadataDocumentId: systemContainer.metadataDocumentId,
        systemSlot: systemContainer.systemSlot,
        name: systemContainer.name,
        icon: systemContainer.icon,
      },
      record,
      {
        localUpdatedAt: systemContainer.updatedAt,
        serverTimestamps: {
          createdAt: systemContainer.createdAt,
          updatedAt: systemContainer.updatedAt,
        },
      },
    );
    // Provisioned system-container metadata is already committed remotely in
    // the organization transaction. Persist the initialized snapshot locally,
    // but do not queue a duplicate write with a second update id.
  }
}

async function persistOrganizationProfileDocumentBootstrap(
  execSql: ExecSql,
  input: RegistrationBootstrapInput,
): Promise<void> {
  const organizationProfileDocument = input.organizationProfileDocument;
  if (!organizationProfileDocument) {
    return;
  }

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
  if (!organizationProfileDocument.initialUpdateCommitted) {
    const initialUpdate = createPendingUpdateFields(
      organizationProfileDocument.initialUpdate,
    );
    if (initialUpdate) {
      await sqlDocumentsPersistence.enqueuePendingUpdate(execSql, {
        localId: organizationProfileDocument.localId,
        ...initialUpdate,
      });
    }
  }
}

async function persistInitialDocumentBootstrap(
  execSql: ExecSql,
  input: {
    accessEpoch: number;
    accessStateHash: string;
    containerId: string;
    documentId: string;
    documentKind: string;
    documentProjectors: DocumentProjectorRegistryInput | undefined;
    documentState: Pick<
      DocumentRecord,
      "contentKeyBundle" | "documentKekTargets" | "documentManifestBundle"
    >;
    initialUpdate: Uint8Array;
    initialUpdateCommitted: boolean;
    localId: string;
  },
): Promise<void> {
  const doc = await createDocument(await getScopedPeerSeed(DOCUMENTS_APP_KIND));
  importUpdates(doc, [input.initialUpdate]);

  // Seed the durable-history checkpoint BEFORE the record row (same crash
  // ordering as store-level creation): bootstrap documents may never see
  // another persist before a restart, and without a checkpoint the reopen
  // falls back to the shallow snapshot and permanently loses full-history
  // exportability.
  await sqlDocumentsPersistence.replaceHistoryCheckpoint?.(execSql, {
    coveredTailIds: [],
    endVersionVector: encodeVersionVector(doc),
    localId: input.localId,
    snapshot: bytesToBase64(exportFullHistorySnapshot(doc)),
  });
  await persistDocumentState({
    currentDoc: doc,
    currentRecord: null,
    documentProjectors: input.documentProjectors ?? [],
    execSql,
    localId: input.localId,
    patch: {
      accessEpoch: input.accessEpoch,
      accessStateHash: input.accessStateHash,
      containerId: input.containerId,
      contentKeyBundle: input.documentState.contentKeyBundle ?? null,
      documentId: input.documentId,
      documentKekTargets: input.documentState.documentKekTargets ?? null,
      documentKind: input.documentKind,
      documentManifestBundle:
        input.documentState.documentManifestBundle ?? null,
    },
    persistence: sqlDocumentsPersistence,
  });

  if (!input.initialUpdateCommitted) {
    const initialUpdate = createPendingUpdateFields(input.initialUpdate);
    if (initialUpdate) {
      await sqlDocumentsPersistence.enqueuePendingUpdate(execSql, {
        localId: input.localId,
        ...initialUpdate,
      });
    }
  }
}

async function persistRosterProfileDocumentBootstrap(
  execSql: ExecSql,
  input: RegistrationBootstrapInput,
): Promise<void> {
  const rosterProfileDocument = input.rosterProfileDocument;
  if (!rosterProfileDocument) {
    return;
  }

  await persistInitialDocumentBootstrap(execSql, {
    accessEpoch: rosterProfileDocument.accessEpoch,
    accessStateHash: rosterProfileDocument.accessStateHash,
    containerId: rosterProfileDocument.containerId,
    documentId: rosterProfileDocument.documentId,
    documentKind: ROSTER_PROFILE_DOCUMENT_KIND,
    documentProjectors: input.documentProjectors,
    documentState: rosterProfileDocument.documentState,
    initialUpdate: rosterProfileDocument.initialUpdate,
    initialUpdateCommitted: rosterProfileDocument.initialUpdateCommitted,
    localId: rosterProfileDocument.localId,
  });
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
    await advanceLocallyAcknowledgedAccessManifestHeadsAtomically({
      execSql: lockedExecSql,
      heads: input.acknowledgedAccessHeads,
    });
    await persistRegistrationPrincipalPolicies({
      adminGroup: input.initialAdminGroupPolicy,
      execSql: lockedExecSql,
      memberGroup: input.initialMemberGroupPolicy,
      organization: input.initialOrganizationPolicy,
    });
    await persistRootContainerBootstrap(lockedExecSql, input);
    await persistRosterProfileContainerBootstrap(lockedExecSql, input);
    await persistRosterProfileDocumentBootstrap(lockedExecSql, input);
    await persistOrganizationMetadataContainerBootstrap(lockedExecSql, input);
    await persistOrganizationProfileDocumentBootstrap(lockedExecSql, input);
    await persistSystemContainersBootstrap(lockedExecSql, input);
  });
}

export async function persistRegistrationBootstrap(
  client: ExecSqlClientLike,
  input: RegistrationBootstrapInput,
): Promise<void> {
  await persistRegistrationBootstrapFromExecSql(createExecSql(client), input);
}
