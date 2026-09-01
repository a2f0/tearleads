import type { DocumentWriterProjectionResponse } from "@symcrypt/validators/response";
import type { ProjectionUserKeyResolver } from "../../data/keyingProjectionVerification";
import { CONTAINER_METADATA_APP_KIND } from "../../data/persistence/container-contents/containerContentsPersistence";
import {
  type PendingUpdateRecord,
  recordDocumentSyncFailure,
} from "../../data/sqlite/documentPersistence";
import {
  createDocumentWriterPublicKeyResolver,
  describeDocumentSyncSubmitFailure,
  type RekeyPendingUpdate,
  resolveDocumentCreateAuthor,
  syncRemoteDocument,
} from "../documents";
import { createRuntimePrincipalPolicyWarmer } from "../principals/runtimePolicyWarmer";
import { metadataIncomingUpdateIsolation } from "./metadataIncomingUpdateIsolation";
import { deferRecoverableMetadataSyncError } from "./metadataSyncErrors";
import type { ContainerMetadataState } from "./metadataTypes";
import type { ContainerContentsWorkflowRuntime } from "./runtime";

type ContainerMetadataSyncApi = Parameters<
  typeof syncRemoteDocument
>[0]["apiClient"] &
  Pick<
    ContainerContentsWorkflowRuntime["apiClient"],
    "getCurrentPrincipalPolicy"
  >;

export interface ContainerMetadataSyncRuntime
  extends Pick<
    ContainerContentsWorkflowRuntime,
    | "auth"
    | "crypto"
    | "infra"
    | "resolveTrustedUserIdentity"
    | "state"
    | "util"
  > {
  apiClient: ContainerMetadataSyncApi;
}

type ContainerMetadataSyncResult = NonNullable<
  Awaited<ReturnType<typeof syncRemoteDocument>>
>;

export interface ContainerMetadataSyncAttempt {
  consumedPullContinuation: ContainerMetadataState["pullContinuation"];
  outgoingUpdateCount: number;
  requestRecord: ContainerMetadataState["record"];
  synced: ContainerMetadataSyncResult;
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
  onPullContinuationInvalidated?: Parameters<
    typeof syncRemoteDocument
  >[0]["onPullContinuationInvalidated"];
  pendingUpdates: readonly PendingUpdateRecord[];
  persistedState: ContainerMetadataState["record"];
  pullContinuation?: ContainerMetadataState["pullContinuation"];
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
  synced: ContainerMetadataSyncResult;
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

export async function syncRemoteContainerMetadata(
  input: SyncRemoteContainerMetadataInput,
): Promise<ContainerMetadataSyncAttempt | null> {
  const { documentId, isCurrent, runtime } = input;
  if (!documentId) return null;
  const author = resolveDocumentCreateAuthor(runtime);
  if (!author) {
    runtime.util.log(
      "Container contents: skipped metadata sync because the writer context is unavailable.",
    );
    return null;
  }
  const execSql = runtime.infra.execSql;
  const metadataScope = {
    appKind: CONTAINER_METADATA_APP_KIND,
    localId: input.containerId,
  };
  const synced = await syncRemoteDocument({
    apiClient: runtime.apiClient,
    author,
    buildRotationSnapshot: input.buildRotationSnapshot,
    documentId,
    execSql,
    isRemoteSyncBlocked: runtime.util.isRemoteSyncBlocked,
    localVersionVector: input.localVersionVector,
    minLsn: input.lastCommitLsn ?? undefined,
    ...metadataIncomingUpdateIsolation({
      currentDocument: input.currentDocument,
      execSql,
      isCurrent,
      metadataScope,
    }),
    onOutgoingUpdatesMaterialized: input.onOutgoingUpdatesMaterialized,
    onPullContinuationInvalidated: input.onPullContinuationInvalidated,
    onSyncTrace: (line) => runtime.util.log(`Container contents: ${line}`),
    onTerminalSubmitFailure: async (failure) => {
      if (!isCurrent()) return;
      await recordDocumentSyncFailure(execSql, metadataScope, {
        attemptedAt: new Date().toISOString(),
        message: describeDocumentSyncSubmitFailure(failure),
        status: failure.status,
      });
    },
    pendingUpdates: input.pendingUpdates,
    persistedState: input.persistedState,
    pullContinuation: input.pullContinuation ?? undefined,
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
    targetSecretKey: input.targetSecretKey,
    warmReferencedPrincipalPolicies:
      createRuntimePrincipalPolicyWarmer(runtime),
    writerProjection: input.writerProjection,
  }).catch((error: unknown) =>
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
