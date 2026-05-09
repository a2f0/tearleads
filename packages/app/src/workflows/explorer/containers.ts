import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import type {
  EncapsulationKeyResponse,
  ReferencedPrincipalStateResponse,
} from "@tearleads/validators/response";
import { createInitializedContainerMetadataDocument } from "../../data/containers";
import type { ProjectionUserKeyResolver } from "../../data/keyingProjectionVerification";
import type { DocumentRecord } from "../../data/sqlite/documentPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import {
  createRemoteContainer,
  moveRemoteContainer,
  shareRemoteContainer,
} from "../containers";
import {
  createRemoteDocument,
  resolveDocumentCreateAuthor,
} from "../documents";
import {
  type ContainerCreateIntentRecord,
  deleteSingleExplorerContainer,
  type ExplorerPersistence,
  listPendingExplorerContainerCreateIntents,
  markExplorerContainerCreateIntentSynced,
  recordExplorerContainerCreateIntentError,
  saveExplorerContainer,
} from "./containerPersistence";
import type {
  ExplorerContainerState,
  ExplorerRemoteContainerHydrationHost,
} from "./remoteHydration";

type ExplorerContainerWorkflowApi = Parameters<
  typeof createRemoteContainer
>[0]["apiClient"] &
  Parameters<typeof shareRemoteContainer>[0]["apiClient"] &
  Parameters<typeof moveRemoteContainer>[0]["apiClient"] &
  Parameters<typeof createRemoteDocument>[0]["apiClient"] & {
    deleteContainerResult(
      containerId: string,
      options?: { reportErrors?: boolean },
    ): Promise<
      | { ok: true }
      | {
          ok: false;
          report: () => void;
          status: number | null;
        }
    >;
    getEncapsulationKey(
      userId: string,
    ): Promise<EncapsulationKeyResponse | null>;
  };

interface ExplorerContainerWorkflowRuntime {
  apiClient: ExplorerContainerWorkflowApi;
  encapsulationKeyPair?: {
    publicKey: Uint8Array;
    secretKey: Uint8Array;
  } | null;
  execSql: ExecSql;
  log: (message: string) => void;
  organizationId?: string | null;
  signingFingerprint?: string | null;
  signingKeyPair?:
    | {
        signingPrivateKey: Uint8Array;
        signingPublicKey: Uint8Array;
      }
    | null
    | undefined;
  userId?: string | null;
}

interface CreatedExplorerContainer {
  accessManifestHash: string;
  containerId: string;
  metadataDocumentId: string;
  organizationId: string;
  parentId: string | null;
  persistedMetadataState: Pick<
    DocumentRecord,
    | "documentId"
    | "contentKeyBundle"
    | "documentKekTargets"
    | "documentManifestBundle"
  >;
}

interface SharedExplorerContainer {
  accessEpoch: number;
  accessManifestHash: string;
  metadataDocumentId: string;
  referencedPrincipalHeads: ReferencedPrincipalStateResponse[];
}

interface RemoteExplorerContainer {
  id: string;
  metadataAccessEpoch: number;
  metadataAccessStateHash: string;
  metadataDocumentId: string;
  metadataReferencedPrincipals: ReferencedPrincipalStateResponse[];
  organizationId: string;
  parentId: string | null;
}

type ExplorerContainerMetadataDocument = Awaited<
  ReturnType<typeof createInitializedContainerMetadataDocument>
>["doc"];

interface CreatedExplorerChildContainer {
  containerState: ExplorerContainerState;
  initialUpdate: Uint8Array;
  shouldEnqueueInitialUpdate: boolean;
}

interface ExplorerContainerCreateIntentSyncState {
  containersById: ReadonlyMap<string, ExplorerContainerState>;
  persistence: ExplorerPersistence;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ExplorerContainerWorkflowRuntime;
}

type ExplorerContainerCreateIntentSyncHost = Pick<
  ExplorerRemoteContainerHydrationHost,
  "persistContainerState"
>;

function readMutationMetadataDocumentId(input: {
  response: {
    accessManifest: { state: Record<string, unknown> };
  };
}): string {
  const metadataDocumentId = Reflect.get(
    input.response.accessManifest.state,
    "metadataDocumentId",
  );
  if (
    typeof metadataDocumentId !== "string" ||
    metadataDocumentId.length === 0
  ) {
    throw new Error("Container mutation response is missing metadata state");
  }

  return metadataDocumentId;
}

function referencedPrincipalHeadsFromResponse(input: {
  response: { referencedPrincipalHeads: readonly unknown[] };
}): ReferencedPrincipalStateResponse[] {
  return input.response.referencedPrincipalHeads.flatMap((head) => {
    if (typeof head !== "object" || head === null) {
      return [];
    }

    const principalType = Reflect.get(head, "principalType");
    const principalId = Reflect.get(head, "principalId");
    const version = Reflect.get(head, "version");
    const keyEpoch = Reflect.get(head, "keyEpoch");
    const stateHash = Reflect.get(head, "stateHash");
    const keyFingerprint = Reflect.get(head, "keyFingerprint");

    if (
      (principalType !== "group" && principalType !== "organization") ||
      typeof principalId !== "string" ||
      !Number.isInteger(version) ||
      !Number.isInteger(keyEpoch) ||
      typeof stateHash !== "string" ||
      typeof keyFingerprint !== "string"
    ) {
      return [];
    }

    return [
      {
        principalType,
        principalId,
        version: version as number,
        keyEpoch: keyEpoch as number,
        stateHash,
        keyFingerprint,
      },
    ];
  });
}

async function buildRemoteExplorerChildContainerState(input: {
  childId: string;
  doc: ExplorerContainerMetadataDocument;
  initialRecord: DocumentRecord;
  parentState: ExplorerContainerState;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ExplorerContainerWorkflowRuntime;
  trimmedName: string;
}): Promise<ExplorerContainerState | null> {
  const {
    childId,
    doc,
    initialRecord,
    parentState,
    resolveProjectionUserKey,
    runtime,
    trimmedName,
  } = input;
  const created = await createRemoteExplorerContainer({
    containerId: childId,
    parentContainerId: parentState.container.id,
    resolveProjectionUserKey,
    runtime,
  });

  if (!created) {
    return null;
  }

  return {
    container: {
      id: created.containerId,
      organizationId: created.organizationId,
      parentId: created.parentId,
      metadataDocumentId: created.metadataDocumentId,
      name: trimmedName,
      icon: null,
    },
    doc,
    record: {
      ...initialRecord,
      accessEpoch: 1,
      accessStateHash: created.accessManifestHash,
      ...created.persistedMetadataState,
    },
  };
}

function buildLocalExplorerChildContainerState(input: {
  childId: string;
  doc: ExplorerContainerMetadataDocument;
  initialRecord: DocumentRecord;
  parentState: ExplorerContainerState;
  trimmedName: string;
}): ExplorerContainerState {
  const { childId, doc, initialRecord, parentState, trimmedName } = input;

  return {
    container: {
      id: childId,
      organizationId: parentState.container.organizationId,
      parentId: parentState.container.id,
      metadataDocumentId: null,
      name: trimmedName,
      icon: null,
    },
    doc,
    record: initialRecord,
  };
}

export async function createExplorerChildContainer(input: {
  createRemote: boolean;
  name: string;
  parentState: ExplorerContainerState;
  persistence: ExplorerPersistence;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ExplorerContainerWorkflowRuntime;
}): Promise<CreatedExplorerChildContainer | null> {
  const {
    createRemote,
    name,
    parentState,
    persistence,
    resolveProjectionUserKey,
    runtime,
  } = input;
  const trimmedName = name.trim();
  if (!trimmedName) {
    return null;
  }

  const childId = crypto.randomUUID();
  const { doc, initialUpdate } =
    await createInitializedContainerMetadataDocument(childId, {
      icon: null,
      name: trimmedName,
    });
  const initialRecord: DocumentRecord = {
    accessEpoch: 1,
    accessStateHash: null,
    contentKeyBundle: null,
    documentId: null,
    documentKekTargets: null,
    documentManifestBundle: null,
    id: childId,
    lastCommitLsn: null,
    loroSnapshot: bytesToBase64(initialUpdate),
  };

  const remoteChildState = createRemote
    ? await buildRemoteExplorerChildContainerState({
        childId,
        doc,
        initialRecord,
        parentState,
        resolveProjectionUserKey,
        runtime,
        trimmedName,
      })
    : null;
  const containerState =
    remoteChildState ??
    buildLocalExplorerChildContainerState({
      childId,
      doc,
      initialRecord,
      parentState,
      trimmedName,
    });
  const createIntent =
    !containerState.record.documentId && containerState.container.parentId
      ? { parentContainerId: containerState.container.parentId }
      : undefined;

  await saveExplorerContainer(
    runtime.execSql,
    persistence,
    containerState.container,
    containerState.record,
    createIntent ? { createIntent } : undefined,
  );

  return {
    containerState,
    initialUpdate,
    shouldEnqueueInitialUpdate:
      !containerState.record.documentId ||
      Boolean(containerState.record.contentKeyBundle),
  };
}

async function createRemoteExplorerContainer(input: {
  containerId: string;
  parentContainerId: string;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ExplorerContainerWorkflowRuntime;
}): Promise<CreatedExplorerContainer | null> {
  const author = resolveDocumentCreateAuthor(input.runtime);
  const { apiClient } = input.runtime;
  const parentSecretKey = input.runtime.encapsulationKeyPair?.secretKey;
  if (!author || !parentSecretKey) {
    input.runtime.log(
      "Explorer: skipped container create because the writer context is unavailable.",
    );
    return null;
  }

  const createdContainer = await createRemoteContainer({
    apiClient,
    author,
    containerId: input.containerId,
    execSql: input.runtime.execSql,
    metadataDocumentId: input.containerId,
    parentContainerId: input.parentContainerId,
    parentSecretKey,
    resolveProjectionUserKey: input.resolveProjectionUserKey,
  });
  if (!createdContainer) {
    return null;
  }

  const createdMetadataDocument = await createRemoteDocument({
    apiClient,
    author,
    containerId: createdContainer.containerId,
    documentId: createdContainer.metadataDocumentId,
    execSql: input.runtime.execSql,
    resolveProjectionUserKey: input.resolveProjectionUserKey,
    targetSecretKey: parentSecretKey,
  });
  if (!createdMetadataDocument) {
    return null;
  }

  return {
    accessManifestHash: createdContainer.response.manifestHead.manifestHash,
    containerId: createdContainer.containerId,
    metadataDocumentId: createdMetadataDocument.documentId,
    organizationId: createdContainer.response.organizationId,
    parentId: createdContainer.response.parentId,
    persistedMetadataState: createdMetadataDocument.persistedState,
  };
}

function hasRemoteExplorerContainerMetadataState(
  containerState: ExplorerContainerState,
): boolean {
  return (
    typeof containerState.record.documentId === "string" &&
    containerState.record.documentId.length > 0 &&
    typeof containerState.record.accessStateHash === "string" &&
    containerState.record.accessStateHash.length > 0
  );
}

async function markExplorerContainerCreateIntentAlreadySynced(input: {
  containerState: ExplorerContainerState;
  intent: ContainerCreateIntentRecord;
  state: ExplorerContainerCreateIntentSyncState;
}) {
  const { containerState, intent, state } = input;
  const remoteMetadataDocumentId = containerState.record.documentId;
  const remoteMetadataAccessStateHash = containerState.record.accessStateHash;

  if (!remoteMetadataDocumentId || !remoteMetadataAccessStateHash) {
    return;
  }

  await markExplorerContainerCreateIntentSynced(
    state.runtime.execSql,
    state.persistence,
    {
      containerId: intent.containerId,
      remoteContainerId: containerState.container.id,
      remoteMetadataAccessStateHash,
      remoteMetadataDocumentId,
    },
  );
}

async function persistCreatedExplorerContainerFromIntent(input: {
  containerState: ExplorerContainerState;
  created: CreatedExplorerContainer;
  host: ExplorerContainerCreateIntentSyncHost;
  state: ExplorerContainerCreateIntentSyncState;
}) {
  const { containerState, created, host, state } = input;

  const nextRecord = await host.persistContainerState(
    containerState,
    {
      accessEpoch: 1,
      accessStateHash: created.accessManifestHash,
      lastCommitLsn: null,
      metadataDocumentId: created.metadataDocumentId,
      organizationId: created.organizationId,
      parentId: created.parentId,
      ...created.persistedMetadataState,
    },
    false,
  );

  containerState.record = nextRecord;
  containerState.container = {
    ...containerState.container,
    metadataDocumentId: created.metadataDocumentId,
    organizationId: created.organizationId,
    parentId: created.parentId,
  };

  await markExplorerContainerCreateIntentSynced(
    state.runtime.execSql,
    state.persistence,
    {
      containerId: containerState.container.id,
      remoteContainerId: created.containerId,
      remoteMetadataAccessStateHash: created.accessManifestHash,
      remoteMetadataDocumentId: created.metadataDocumentId,
    },
  );
}

async function trySyncPendingExplorerContainerCreateIntent(input: {
  host: ExplorerContainerCreateIntentSyncHost;
  intent: ContainerCreateIntentRecord;
  state: ExplorerContainerCreateIntentSyncState;
}): Promise<"created" | "blocked" | "failed"> {
  const { host, intent, state } = input;
  const containerState = state.containersById.get(intent.containerId);
  const parentState = state.containersById.get(intent.parentContainerId);

  if (!containerState || !parentState) {
    await recordExplorerContainerCreateIntentError(
      state.runtime.execSql,
      state.persistence,
      intent.containerId,
      "Container create intent references a missing local container",
    );
    return "failed";
  }

  if (hasRemoteExplorerContainerMetadataState(containerState)) {
    await markExplorerContainerCreateIntentAlreadySynced({
      containerState,
      intent,
      state,
    });
    return "created";
  }

  if (!hasRemoteExplorerContainerMetadataState(parentState)) {
    return "blocked";
  }

  const created = await createRemoteExplorerContainer({
    containerId: containerState.container.id,
    parentContainerId: parentState.container.id,
    resolveProjectionUserKey: state.resolveProjectionUserKey,
    runtime: state.runtime,
  });

  if (!created) {
    await recordExplorerContainerCreateIntentError(
      state.runtime.execSql,
      state.persistence,
      intent.containerId,
      "Remote container create was rejected or unavailable",
    );
    return "failed";
  }

  await persistCreatedExplorerContainerFromIntent({
    containerState,
    created,
    host,
    state,
  });
  state.runtime.log(
    `Explorer: synced local container create ${containerState.container.id}`,
  );
  return "created";
}

export async function syncPendingExplorerContainerCreateIntents(input: {
  host: ExplorerContainerCreateIntentSyncHost;
  state: ExplorerContainerCreateIntentSyncState;
}): Promise<number> {
  const { host, state } = input;
  const pendingIntents = await listPendingExplorerContainerCreateIntents(
    state.runtime.execSql,
    state.persistence,
  );
  const remainingContainerIds = new Set(
    pendingIntents.map((intent) => intent.containerId),
  );
  let createdCount = 0;
  let progressed = true;

  while (progressed) {
    progressed = false;

    for (const intent of pendingIntents) {
      if (!remainingContainerIds.has(intent.containerId)) {
        continue;
      }

      const result = await trySyncPendingExplorerContainerCreateIntent({
        host,
        intent,
        state,
      });

      if (result === "blocked") {
        continue;
      }

      remainingContainerIds.delete(intent.containerId);
      progressed = result === "created" || progressed;
      if (result === "created") {
        createdCount += 1;
      }
    }
  }

  return createdCount;
}

export async function shareRemoteExplorerContainer(input: {
  accessLevel: "read" | "write" | "admin";
  containerId: string;
  recipientUserId: string;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ExplorerContainerWorkflowRuntime;
}): Promise<SharedExplorerContainer | null> {
  const author = resolveDocumentCreateAuthor(input.runtime);
  const { apiClient } = input.runtime;
  const targetSecretKey = input.runtime.encapsulationKeyPair?.secretKey;
  if (!author || !targetSecretKey) {
    input.runtime.log(
      "Explorer: skipped container share because the writer context is unavailable.",
    );
    return null;
  }

  const recipientKey = await input.runtime.apiClient.getEncapsulationKey(
    input.recipientUserId,
  );
  if (!recipientKey) {
    return null;
  }

  const shared = await shareRemoteContainer({
    accessLevel: input.accessLevel,
    apiClient,
    author,
    containerId: input.containerId,
    execSql: input.runtime.execSql,
    recipientEncapsulationPublicKey: base64ToBytes(
      recipientKey.encapsulationPublicKey,
    ),
    recipientUserId: input.recipientUserId,
    resolveProjectionUserKey: input.resolveProjectionUserKey,
    targetSecretKey,
  });
  if (!shared) {
    return null;
  }

  return {
    accessManifestHash: shared.response.manifestHead.manifestHash,
    accessEpoch: shared.response.manifestHead.epoch,
    metadataDocumentId: readMutationMetadataDocumentId({
      response: shared.response,
    }),
    referencedPrincipalHeads: referencedPrincipalHeadsFromResponse({
      response: shared.response,
    }),
  };
}

export async function moveRemoteExplorerContainer(input: {
  containerId: string;
  parentContainerId: string;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ExplorerContainerWorkflowRuntime;
}): Promise<RemoteExplorerContainer | null> {
  const author = resolveDocumentCreateAuthor(input.runtime);
  const { apiClient } = input.runtime;
  const targetSecretKey = input.runtime.encapsulationKeyPair?.secretKey;
  if (!author || !targetSecretKey) {
    input.runtime.log(
      "Explorer: skipped container move because the writer context is unavailable.",
    );
    return null;
  }

  const moved = await moveRemoteContainer({
    apiClient,
    author,
    containerId: input.containerId,
    destinationParentContainerId: input.parentContainerId,
    execSql: input.runtime.execSql,
    resolveProjectionUserKey: input.resolveProjectionUserKey,
    targetSecretKey,
  });
  if (!moved) {
    return null;
  }

  return {
    id: moved.response.containerId,
    organizationId: moved.response.organizationId,
    parentId: moved.response.parentId,
    metadataDocumentId: readMutationMetadataDocumentId({
      response: moved.response,
    }),
    metadataAccessEpoch: moved.response.manifestHead.epoch,
    metadataAccessStateHash: moved.response.manifestHead.manifestHash,
    metadataReferencedPrincipals: referencedPrincipalHeadsFromResponse({
      response: moved.response,
    }),
  };
}

async function deleteRemoteExplorerContainer(input: {
  containerId: string;
  runtime: ExplorerContainerWorkflowRuntime;
}): Promise<boolean> {
  const deleteResult = await input.runtime.apiClient.deleteContainerResult(
    input.containerId,
    { reportErrors: false },
  );
  if (!deleteResult.ok && deleteResult.status !== 404) {
    deleteResult.report();
    return false;
  }

  return true;
}

export async function deleteExplorerContainerState(input: {
  containerState: ExplorerContainerState;
  persistence: ExplorerPersistence;
  runtime: ExplorerContainerWorkflowRuntime;
}): Promise<boolean> {
  const isRemoteContainer =
    typeof input.containerState.record.documentId === "string" &&
    input.containerState.record.documentId.length > 0;

  if (isRemoteContainer) {
    const deletedRemoteContainer = await deleteRemoteExplorerContainer({
      containerId: input.containerState.container.id,
      runtime: input.runtime,
    });
    if (!deletedRemoteContainer) {
      return false;
    }
  }

  await deleteSingleExplorerContainer(
    input.runtime.execSql,
    input.persistence,
    input.containerState.container.id,
  );
  return true;
}
