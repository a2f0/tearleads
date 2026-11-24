import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import type { ProjectionUserKeyResolver } from "../../../data/keyingProjectionVerification";
import type { PendingUpdateRecord } from "../../../data/persistence/documents/records";
import {
  createDocumentWriterPublicKeyResolver,
  type DocumentPeerRebaser,
  describeDocumentSyncSubmitFailure,
  type RekeyPendingUpdate,
  RemoteDocumentService,
  type RemoteDocumentServiceApi,
  resolveDocumentCreateAuthor,
  type SyncRemoteDocumentRequest,
  type SyncRemoteDocumentResult,
} from "../../documents";
import type { PrincipalPolicyOperation } from "../../principals/principalPolicyService";
import type { ContainerContentsWorkflowRuntime } from "../runtime";
import {
  metadataIncomingUpdateIsolation,
  recordCurrentMetadataSyncFailure,
} from "./metadataIncomingUpdateIsolation";
import { deferRecoverableMetadataSyncError } from "./metadataSyncErrors";
import {
  containerMetadataScope,
  readContainerMetadataProcessedCursor,
} from "./metadataSyncVerdicts";
import type { ContainerMetadataState } from "./metadataTypes";

export interface ContainerMetadataSyncRuntime
  extends Pick<
    ContainerContentsWorkflowRuntime,
    | "auth"
    | "crypto"
    | "infra"
    | "principalPolicies"
    | "resolveTrustedUserIdentity"
    | "state"
    | "util"
  > {
  apiClient: RemoteDocumentServiceApi;
}

export interface ContainerMetadataSyncAttempt {
  consumedPullContinuation: ContainerMetadataState["pullContinuation"];
  outgoingUpdateCount: number;
  requestRecord: ContainerMetadataState["record"];
  synced: SyncRemoteDocumentResult;
}

interface SyncRemoteContainerMetadataInput {
  buildRotationSnapshot?: (() => Promise<Uint8Array | null>) | undefined;
  containerId: string;
  currentDocument: ContainerMetadataState["doc"];
  documentId: string | null;
  isCurrent: () => boolean;
  lastCommitLsn?: string | null | undefined;
  localVersionVector: string | null;
  onOutgoingUpdatesMaterialized?:
    | ((updateIds: readonly string[]) => void)
    | undefined;
  onPullContinuationInvalidated?: SyncRemoteDocumentRequest["onPullContinuationInvalidated"];
  pendingUpdates: readonly PendingUpdateRecord[];
  persistedState: ContainerMetadataState["record"];
  policyOperation: PrincipalPolicyOperation;
  pullContinuation?: ContainerMetadataState["pullContinuation"];
  /** Moves the live metadata off peers the server refused as another user's. */
  rebaseOntoFreshPeer?: DocumentPeerRebaser | undefined;
  rekeyPendingUpdate: RekeyPendingUpdate;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ContainerMetadataSyncRuntime;
  targetSecretKey: Uint8Array;
  writerProjection?: DocumentWriterProjectionResponse | undefined;
}

function createContainerMetadataSyncAttempt(input: {
  outgoingUpdateCount: number;
  requestedPullContinuation: ContainerMetadataState["pullContinuation"];
  requestRecord: ContainerMetadataState["record"];
  synced: SyncRemoteDocumentResult;
}): ContainerMetadataSyncAttempt {
  return {
    consumedPullContinuation:
      input.synced.plan.request.pullCursor === undefined
        ? null
        : (input.requestedPullContinuation ?? null),
    outgoingUpdateCount: input.outgoingUpdateCount,
    requestRecord: input.requestRecord,
    synced: input.synced,
  };
}

function resolveMetadataSyncAuthor(runtime: ContainerMetadataSyncRuntime) {
  const author = resolveDocumentCreateAuthor(runtime);
  if (!author) {
    runtime.util.log(
      "Container contents: skipped metadata sync because the writer context is unavailable.",
    );
  }
  return author;
}

export async function syncRemoteContainerMetadata(
  input: SyncRemoteContainerMetadataInput,
): Promise<ContainerMetadataSyncAttempt | null> {
  const { documentId, isCurrent, runtime } = input;
  if (!documentId) return null;
  const author = resolveMetadataSyncAuthor(runtime);
  if (!author) return null;
  const execSql = runtime.infra.execSql;
  const metadataScope = containerMetadataScope(input.containerId);
  const processedThroughUpdateId = await readContainerMetadataProcessedCursor(
    execSql,
    { ...input, documentId },
  );
  if (!isCurrent()) return null;
  const remoteDocuments = new RemoteDocumentService({
    api: runtime.apiClient,
    encapsulationSecretKey: input.targetSecretKey,
    execSql,
    isRemoteSyncBlocked: runtime.util.isRemoteSyncBlocked,
  });
  const synced = await remoteDocuments
    .syncRemoteDocument({
      author,
      buildRotationSnapshot: input.buildRotationSnapshot,
      documentId,
      localVersionVector: input.localVersionVector,
      minLsn: input.lastCommitLsn ?? undefined,
      ...metadataIncomingUpdateIsolation({
        currentDocument: input.currentDocument,
        documentId,
        execSql,
        isCurrent,
        logError: runtime.util.logError,
        metadataScope,
      }),
      onOutgoingUpdatesMaterialized: input.onOutgoingUpdatesMaterialized,
      onPullContinuationInvalidated: input.onPullContinuationInvalidated,
      onSyncTrace: (line) => runtime.util.log(`Container contents: ${line}`),
      onTerminalSubmitFailure: async (failure) => {
        await recordCurrentMetadataSyncFailure({
          execSql,
          failure: {
            attemptedAt: new Date().toISOString(),
            message: describeDocumentSyncSubmitFailure(failure),
            status: failure.status,
          },
          isCurrent,
          metadataScope,
        });
      },
      pendingUpdates: input.pendingUpdates,
      persistedState: input.persistedState,
      processedThroughUpdateId,
      pullContinuation: input.pullContinuation ?? undefined,
      pullRecoveryRequired:
        input.persistedState.pullContinuationRecoveryRequired === true,
      rebaseOntoFreshPeer: input.rebaseOntoFreshPeer,
      rekeyPendingUpdate: (rekeyExecSql, updateId) =>
        isCurrent()
          ? input.rekeyPendingUpdate(rekeyExecSql, updateId)
          : Promise.resolve(null),
      resolveProjectionUserKey: input.resolveProjectionUserKey,
      resolveWriterPublicKey: createDocumentWriterPublicKeyResolver({
        logPrefix: "Container contents",
        runtime,
        writerKeyLabel: "metadata writer key",
      }),
      stillCurrent: isCurrent,
      warmReferencedPrincipalPolicies: runtime.principalPolicies.createWarmer({
        operation: input.policyOperation,
      }),
      writerProjection: input.writerProjection,
    })
    .catch((error: unknown) =>
      deferRecoverableMetadataSyncError({
        containerId: input.containerId,
        error,
        runtime,
      }),
    );
  if (!synced) return null;
  return createContainerMetadataSyncAttempt({
    outgoingUpdateCount: input.pendingUpdates.length,
    requestedPullContinuation: input.pullContinuation,
    requestRecord: input.persistedState,
    synced,
  });
}
