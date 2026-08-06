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
import {
  type ContainerMetadataRecord,
  sqlContainerContentsPersistence,
} from "../../data/persistence/container-contents/containerContentsPersistence";
import {
  DOCUMENTS_APP_KIND,
  sqlDocumentsPersistence,
} from "../../data/persistence/documents/documentsPersistence";
import {
  advanceLocallyAcknowledgedAccessManifestHeadsAtomically,
  type LocallyAcknowledgedAccessManifestHead,
} from "../../data/persistence/locallyAcknowledgedCheckpointPersistence";
import type { DocumentRecord } from "../../data/sqlite/documentPersistence";
import { getClientSQLitePersistenceRuntime } from "../../data/sqlite/sqlitePersistenceRuntime";
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

interface ProvisionedContainerBootstrapInput {
  accessEpoch: number;
  accessStateHash: string;
  containerId: string;
  createdAt: string;
  metadataDocumentId: string;
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
}

interface ProvisionedProfileDocumentBootstrapInput {
  accessEpoch: number;
  accessStateHash: string;
  containerId: string;
  documentId: string;
  documentState: ProvisionedContainerBootstrapInput["metadataState"];
  initialUpdate: Uint8Array;
  initialUpdateCommitted: boolean;
  localId: string;
}

export interface RegistrationBootstrapInput {
  acknowledgedAccessHeads: readonly LocallyAcknowledgedAccessManifestHead[];
  /** Checked inside the mutation queue claim; false skips every write. */
  canStartDurableMutation?: (() => boolean) | undefined;
  /**
   * @internal Test-only synchronization seam. Invoked synchronously
   * immediately before this persist joins the serialized mutation queue — no interleaving can separate the two. Lets
   * identity-race tests deterministically place an identity replacement
   * inside the queue-wait window instead of sleeping.
   */
  onPersistQueued?: (() => void) | undefined;
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
  rosterProfileContainer?: ProvisionedContainerBootstrapInput & {
    metadataInitialUpdate: Uint8Array;
    metadataInitialUpdateCommitted?: boolean | undefined;
  };
  organizationMetadataContainer?: ProvisionedContainerBootstrapInput & {
    metadataInitialUpdate: Uint8Array;
    metadataInitialUpdateCommitted?: boolean | undefined;
  };
  organizationProfileDocument?: ProvisionedProfileDocumentBootstrapInput;
  rosterProfileDocument?: ProvisionedProfileDocumentBootstrapInput;
  // Additional app-owned system containers provisioned with the organization
  // (e.g. a trash bin). Each carries its own display name and icon (unlike the
  // roster/organization-metadata containers, whose names are fixed), since the
  // caller declares them.
  systemContainers?: Array<
    ProvisionedContainerBootstrapInput & {
      icon: string | null;
      name: string;
    }
  >;
  documentProjectors?: DocumentProjectorRegistryInput | undefined;
  organizationId: string;
  userId: string;
}
async function persistProvisionedContainerBootstrap(
  execSql: ExecSql,
  input: {
    container: ProvisionedContainerBootstrapInput;
    icon: string | null;
    name: string;
    organizationId: string;
    parentId: string;
  },
): Promise<void> {
  const { container } = input;
  const metadataState = container.metadataState;
  const record: ContainerMetadataRecord = {
    accessEpoch: container.accessEpoch,
    accessStateHash: container.accessStateHash,
    documentId: container.metadataDocumentId,
    id: container.containerId,
    lastCommitLsn: null,
    metadataUpdates: container.metadataSnapshot,
    snapshotEndVersion: "",
    contentKeyBundle: metadataState.contentKeyBundle ?? null,
    documentKekTargets: metadataState.documentKekTargets ?? null,
    documentManifestBundle: metadataState.documentManifestBundle ?? null,
  };
  await sqlContainerContentsPersistence.saveContainer(
    execSql,
    {
      id: container.containerId,
      effectiveAccessLevel: "admin",
      organizationId: input.organizationId,
      parentId: input.parentId,
      metadataDocumentId: container.metadataDocumentId,
      systemSlot: container.systemSlot,
      name: input.name,
      icon: input.icon,
    },
    record,
    {
      localUpdatedAt: container.updatedAt,
      serverTimestamps: {
        createdAt: container.createdAt,
        updatedAt: container.updatedAt,
      },
    },
  );
}

async function persistRootContainerBootstrap(
  execSql: ExecSql,
  input: RegistrationBootstrapInput,
): Promise<void> {
  const rootRecord: ContainerMetadataRecord = {
    accessEpoch: input.rootMetadataAccessEpoch,
    accessStateHash: input.rootMetadataAccessStateHash,
    documentId: input.rootMetadataDocumentId,
    id: input.containerId,
    lastCommitLsn: null,
    metadataUpdates: input.rootMetadataSnapshot,
    snapshotEndVersion: "",
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

  await persistProvisionedContainerBootstrap(execSql, {
    container: rosterProfileContainer,
    icon: null,
    name: ORGANIZATION_ROSTER_PROFILE_CONTAINER_NAME,
    organizationId: input.organizationId,
    parentId: input.containerId,
  });
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

  // The founder persisting at provisioning reaches this container as an
  // admin via root inheritance; a Members-only member syncing it later
  // derives their own read-level access from the group grant.
  await persistProvisionedContainerBootstrap(execSql, {
    container: organizationMetadataContainer,
    icon: null,
    name: ORGANIZATION_METADATA_CONTAINER_NAME,
    organizationId: input.organizationId,
    parentId: input.containerId,
  });
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
    await persistProvisionedContainerBootstrap(execSql, {
      container: systemContainer,
      icon: systemContainer.icon,
      name: systemContainer.name,
      organizationId: input.organizationId,
      parentId: input.containerId,
    });
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

  await persistInitialDocumentBootstrap(execSql, {
    accessEpoch: organizationProfileDocument.accessEpoch,
    accessStateHash: organizationProfileDocument.accessStateHash,
    containerId: organizationProfileDocument.containerId,
    documentId: organizationProfileDocument.documentId,
    documentKind: ORGANIZATION_PROFILE_DOCUMENT_KIND,
    documentProjectors: input.documentProjectors,
    documentState: organizationProfileDocument.documentState,
    initialUpdate: organizationProfileDocument.initialUpdate,
    initialUpdateCommitted: organizationProfileDocument.initialUpdateCommitted,
    localId: organizationProfileDocument.localId,
  });
}

async function seedBootstrapHistoryCheckpoint(
  execSql: ExecSql,
  localId: string,
  doc: Awaited<ReturnType<typeof createDocument>>,
): Promise<void> {
  await sqlDocumentsPersistence.replaceHistoryCheckpoint(execSql, {
    coveredTailIds: [],
    endVersionVector: encodeVersionVector(doc),
    force: true,
    localId,
    snapshot: bytesToBase64(exportFullHistorySnapshot(doc)),
  });
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
  // ordering as store-level creation): the checkpoint is the only content
  // source, so a record row without one would reopen empty.
  await seedBootstrapHistoryCheckpoint(execSql, input.localId, doc);
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
      // The checkpoint seeded above covers exactly this frontier.
      snapshotEndVersion: encodeVersionVector(doc),
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

// Thrown inside the bootstrap transaction to roll the whole write set back
// when the pre-commit currency check finds the identity replaced. Private:
// callers observe the rollback as a false "persisted" result, never as an
// exception.
class StaleBootstrapIdentityError extends Error {
  constructor() {
    super("Registration bootstrap rolled back: identity replaced");
  }
}

/**
 * Persists the local root-container bootstrap created during successful
 * registration so container contents can initialize from SQLite on first
 * login — atomically: every write lands inside ONE transaction whose last
 * act re-checks identity currency, so an identity replaced anywhere between
 * the queue claim and the commit rolls the entire bootstrap back instead of
 * leaving a partial one. Resolves false when either currency check rejected
 * the write, so callers do not report a bootstrap that was never persisted.
 */
export async function persistRegistrationBootstrapFromExecSql(
  execSql: ExecSql,
  input: RegistrationBootstrapInput,
): Promise<boolean> {
  input.onPersistQueued?.();
  return runSerializedSqlMutation(execSql, async (lockedExecSql) => {
    // In-mutex currency check, adjacent to the serialized-mutation claim
    // (see persistDocumentState): the identity can be replaced while this
    // persist waits for the queue, and its bootstrap must not be written
    // through a client the replacement closed or renewed.
    if (input.canStartDurableMutation && !input.canStartDurableMutation()) {
      return false;
    }
    // Idempotent DDL stays outside the atomic boundary.
    await sqlContainerContentsPersistence.ensureSchema(lockedExecSql);
    await sqlDocumentsPersistence.ensureSchema(lockedExecSql);
    try {
      await getClientSQLitePersistenceRuntime(lockedExecSql).transaction(
        async () => {
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
          await persistOrganizationMetadataContainerBootstrap(
            lockedExecSql,
            input,
          );
          await persistOrganizationProfileDocumentBootstrap(
            lockedExecSql,
            input,
          );
          await persistSystemContainersBootstrap(lockedExecSql, input);
          // Pre-commit currency guard: the sequence above awaits real work,
          // so the identity can be replaced mid-sequence. Refusing HERE rolls
          // back every write of this transaction, closing the partial-persist
          // window a single entry check leaves open.
          if (
            input.canStartDurableMutation &&
            !input.canStartDurableMutation()
          ) {
            throw new StaleBootstrapIdentityError();
          }
        },
      );
    } catch (error: unknown) {
      if (error instanceof StaleBootstrapIdentityError) {
        return false;
      }
      throw error;
    }
    return true;
  });
}

export async function persistRegistrationBootstrap(
  client: ExecSqlClientLike,
  input: RegistrationBootstrapInput,
): Promise<void> {
  await persistRegistrationBootstrapFromExecSql(createExecSql(client), input);
}
