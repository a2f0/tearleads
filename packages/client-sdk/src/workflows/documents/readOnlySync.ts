import type {
  DocumentCreateResponse,
  DocumentSyncResponse,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import {
  isAccessManifestBundleWireResponse,
  isDocumentContentKeyBundleResponse,
  isDocumentKekTargetsResponse,
} from "@tearleads/validators/response";
import type {
  DocumentSyncUpdateIsolationError,
  IncomingDocumentSyncUpdateValidator,
} from "../../data/documents/shared/documentSyncUpdateIsolation";
import {
  isRetryableDocumentSyncConflict,
  persistedDocumentSyncStateFromResponse,
  submitDocumentSync,
} from "../../data/documents/shared/responses";
import {
  type DocumentSyncPullContinuation,
  resolvePullContinuationMinLsn,
} from "../../data/documents/shared/syncPagination";
import type {
  DocumentCreateAuthor,
  DocumentSyncApi,
  DocumentSyncPlan,
  DocumentWriterPublicKeyResolver,
  PersistedDocumentSyncState,
  SyncRemoteDocumentResult,
} from "../../data/documents/shared/types";
import { projectionVerificationOptions } from "../../data/documents/shared/types";
import { readCanonicalRecord } from "../../data/keyingCanonicalJson";
import type {
  ProjectionUserKeyResolver,
  ReferencedPrincipalPolicyWarmer,
} from "../../data/keyingProjectionVerification";
import type { PendingUpdateRecord } from "../../data/sqlite/documentPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { limitDocumentSyncRequestBytes } from "../../data/sync/documentSyncOutgoingBatch";
import {
  handleReadOnlyProjectionCompletionError,
  REFRESH_CACHED_PROJECTION,
} from "./readOnlyProjectionFailure";
import type { DocumentSyncContainerRekeyBuilder } from "./syncAttemptState";
import { DocumentRawHistoryUnavailableError } from "./syncContentKeys";
import {
  handleUpstreamDeletedDocumentSyncFailure,
  projectionIntegrityErrorCode,
  type RemoteDocumentDeletionHandler,
  type TerminalSubmitFailureHandler,
} from "./syncFailureClassification";
import {
  assertRawContinuationCanRetry,
  refreshSyncAttemptWriterProjection,
  resolveSyncAttemptWriterProjection,
} from "./syncFailures";
import { buildDocumentSyncPlan } from "./syncPlanIdentity";
import { buildMaterializedDocumentSyncPlan } from "./syncPlanMaterial";
import type { RekeyPendingUpdate } from "./syncRecoveryRekey";
import { syncRemoteDocumentResultFromResponse } from "./syncResponseResult";
import { type DocumentSyncTraceEmitter, traceSubmitFailed } from "./syncTrace";

async function completeReadOnlyRemoteDocumentSyncWithProjection(
  input: Omit<ReadOnlyDocumentSyncCompletionInput, "writerProjection"> & {
    writerProjection: DocumentWriterProjectionResponse;
  },
): Promise<SyncRemoteDocumentResult> {
  const materializedPlan = await buildMaterializedDocumentSyncPlan({
    author: input.author,
    execSql: input.execSql,
    historyMode: input.historyMode,
    localVersionVector: input.localVersionVector,
    minLsn: resolvePullContinuationMinLsn(input.pullContinuation, input.minLsn),
    pullCursor: input.pullContinuation?.cursor,
    onSyncTrace: input.onSyncTrace,
    pendingUpdates: [],
    signedAt: input.signedAt,
    targetSecretKey: input.targetSecretKey,
    writerProjection: input.writerProjection,
    ...projectionVerificationOptions(input),
  });

  const result = await syncRemoteDocumentResultFromResponse({
    ...projectionVerificationOptions(input),
    execSql: input.execSql,
    materializedPlan,
    recoveryPendingUpdatesById: new Map(),
    resolveWriterPublicKey: input.resolveWriterPublicKey,
    response: input.response,
    targetSecretKey: input.targetSecretKey,
    validateIncomingUpdates: input.validateIncomingUpdates,
    writerProjection: input.writerProjection,
    resolveProjectionUserKey: input.resolveProjectionUserKey,
  });
  return {
    ...result,
    hasIncompletePull: !input.pullComplete,
  };
}

function parsePersistedDocumentSyncRecord<T>(
  value: string | null | undefined,
  label: string,
  isRecord: (value: unknown) => value is T,
): T | null {
  if (!value) {
    return null;
  }

  try {
    const record = readCanonicalRecord(JSON.parse(value), label);
    return isRecord(record) ? record : null;
  } catch {
    return null;
  }
}

function parsePersistedDocumentSyncState(
  persistedState: PersistedDocumentSyncState | null | undefined,
  documentId: string,
): {
  contentKeyBundle: DocumentCreateResponse["contentKeyBundle"];
  documentKekTargets: DocumentSyncResponse["documentKekTargets"];
  documentManifest: DocumentCreateResponse["accessManifest"];
} | null {
  if (persistedState?.documentId !== documentId) {
    return null;
  }

  const contentKeyBundle = parsePersistedDocumentSyncRecord(
    persistedState.contentKeyBundle,
    "Persisted document sync content-key bundle",
    isDocumentContentKeyBundleResponse,
  );
  const documentKekTargets = parsePersistedDocumentSyncRecord(
    persistedState.documentKekTargets,
    "Persisted document sync KEK targets",
    isDocumentKekTargetsResponse,
  );
  const documentManifest = parsePersistedDocumentSyncRecord(
    persistedState.documentManifestBundle,
    "Persisted document sync manifest",
    isAccessManifestBundleWireResponse,
  );

  if (!contentKeyBundle || !documentKekTargets || !documentManifest) {
    return null;
  }

  return {
    contentKeyBundle,
    documentKekTargets,
    documentManifest,
  };
}

async function buildReadOnlyDocumentSyncPlanFromPersistedState(input: {
  author: DocumentCreateAuthor;
  documentId: string;
  historyMode?: "raw" | undefined;
  localVersionVector: string | null;
  minLsn?: string | undefined;
  pullContinuation?: DocumentSyncPullContinuation | undefined;
  persistedState?: PersistedDocumentSyncState | null | undefined;
  signedAt?: string | undefined;
}): Promise<DocumentSyncPlan | null> {
  const persisted = parsePersistedDocumentSyncState(
    input.persistedState,
    input.documentId,
  );
  if (!persisted) {
    return null;
  }

  const plan = await buildDocumentSyncPlan({
    author: input.author,
    contentKeyBundle: persisted.contentKeyBundle,
    documentId: input.documentId,
    documentKekTargets: persisted.documentKekTargets,
    documentManifest: persisted.documentManifest,
    historyMode: input.historyMode,
    localVersionVector: input.localVersionVector,
    minLsn: resolvePullContinuationMinLsn(input.pullContinuation, input.minLsn),
    outgoingUpdates: [],
    pullCursor: input.pullContinuation?.cursor,
    signedAt: input.signedAt,
  });
  const request = limitDocumentSyncRequestBytes(plan.request);
  return request === plan.request ? plan : { ...plan, request };
}

type PersistedReadOnlyDocumentSyncResult =
  | {
      kind: "completed";
      result: SyncRemoteDocumentResult | null;
    }
  | {
      kind: "not_completed";
    };

interface ReadOnlyDocumentSyncCompletionInput {
  apiClient: DocumentSyncApi;
  author: DocumentCreateAuthor;
  documentId: string;
  execSql: ExecSql;
  historyMode?: "raw" | undefined;
  localVersionVector: string | null;
  minLsn?: string | undefined;
  pullContinuation?: DocumentSyncPullContinuation | undefined;
  onReadOnlyProjectionFailure?: TerminalSubmitFailureHandler | undefined;
  onRemoteDocumentDeleted?: RemoteDocumentDeletionHandler | undefined;
  onSyncTrace?: DocumentSyncTraceEmitter | undefined;
  pullComplete: boolean;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  resolveWriterPublicKey: DocumentWriterPublicKeyResolver;
  response: DocumentSyncResponse;
  signedAt?: string | undefined;
  stillCurrent?: (() => boolean) | undefined;
  targetSecretKey: Uint8Array;
  validateIncomingUpdates: IncomingDocumentSyncUpdateValidator;
  warmReferencedPrincipalPolicies?: ReferencedPrincipalPolicyWarmer | undefined;
  writerProjection?: DocumentWriterProjectionResponse | undefined;
}

async function tryCompleteReadOnlyRemoteDocumentSyncWithProjection(input: {
  allowCachedProjectionRefresh: boolean;
  completion: ReadOnlyDocumentSyncCompletionInput;
  writerProjection: DocumentWriterProjectionResponse;
}): Promise<
  | DocumentRawHistoryUnavailableError
  | SyncRemoteDocumentResult
  | null
  | typeof REFRESH_CACHED_PROJECTION
> {
  try {
    return await completeReadOnlyRemoteDocumentSyncWithProjection({
      ...input.completion,
      writerProjection: input.writerProjection,
    });
  } catch (error) {
    return handleReadOnlyProjectionCompletionError(error, {
      allowCachedProjectionRefresh: input.allowCachedProjectionRefresh,
      historyMode: input.completion.historyMode,
    });
  }
}
async function completeReadOnlyRemoteDocumentSyncWithUpdates(
  input: ReadOnlyDocumentSyncCompletionInput,
): Promise<PersistedReadOnlyDocumentSyncResult> {
  const reusableWriterProjection =
    input.writerProjection?.documentId === input.documentId
      ? input.writerProjection
      : null;
  const writerProjection =
    reusableWriterProjection ??
    (await resolveSyncAttemptWriterProjection({
      apiClient: input.apiClient,
      documentId: input.documentId,
      onRemoteDocumentDeleted: input.onRemoteDocumentDeleted,
      onSyncTrace: input.onSyncTrace,
      onTerminalFailure: input.onReadOnlyProjectionFailure,
      reusableWriterProjection: null,
      stillCurrent: input.stillCurrent,
    }));
  if (!writerProjection) {
    return { kind: "completed", result: null };
  }
  const canRefreshProjection =
    input.historyMode === "raw" || Boolean(reusableWriterProjection);
  let result:
    | DocumentRawHistoryUnavailableError
    | SyncRemoteDocumentResult
    | null
    | typeof REFRESH_CACHED_PROJECTION = null;
  let retryAfterRollback = false;
  try {
    result = await tryCompleteReadOnlyRemoteDocumentSyncWithProjection({
      allowCachedProjectionRefresh: canRefreshProjection,
      completion: input,
      writerProjection,
    });
  } catch (error) {
    if (projectionIntegrityErrorCode(error) !== "rollback") {
      throw error;
    }
    retryAfterRollback = true;
  }
  if (
    !retryAfterRollback &&
    result !== REFRESH_CACHED_PROJECTION &&
    !(result instanceof DocumentRawHistoryUnavailableError) &&
    (result || !reusableWriterProjection)
  ) {
    return { kind: "completed", result };
  }
  const freshWriterProjection = await refreshSyncAttemptWriterProjection({
    apiClient: input.apiClient,
    documentId: input.documentId,
    onRemoteDocumentDeleted: input.onRemoteDocumentDeleted,
    onSyncTrace: input.onSyncTrace,
    onTerminalFailure: input.onReadOnlyProjectionFailure,
    stillCurrent: input.stillCurrent,
    unavailableError:
      result instanceof DocumentRawHistoryUnavailableError ? result : undefined,
  });
  if (!freshWriterProjection) {
    return { kind: "completed", result: null };
  }
  const freshResult = await tryCompleteReadOnlyRemoteDocumentSyncWithProjection(
    {
      allowCachedProjectionRefresh: false,
      completion: input,
      writerProjection: freshWriterProjection,
    },
  );
  if (
    freshResult === REFRESH_CACHED_PROJECTION ||
    freshResult instanceof DocumentRawHistoryUnavailableError
  ) {
    throw new Error("Fresh document projection unexpectedly requested refresh");
  }
  return freshResult
    ? { kind: "completed", result: freshResult }
    : { kind: "not_completed" };
}
async function syncReadOnlyRemoteDocumentFromPersistedState(
  input: Omit<
    ReadOnlyDocumentSyncCompletionInput,
    "pullComplete" | "response"
  > & {
    persistedState?: PersistedDocumentSyncState | null | undefined;
  },
): Promise<PersistedReadOnlyDocumentSyncResult> {
  let plan: DocumentSyncPlan | null;
  try {
    plan = await buildReadOnlyDocumentSyncPlanFromPersistedState(input);
  } catch {
    plan = null;
  }
  if (!plan) {
    return { kind: "not_completed" };
  }
  if (input.stillCurrent?.() === false) {
    return { kind: "completed", result: null };
  }
  const submitted = await submitDocumentSync({
    apiClient: input.apiClient,
    expectedCommitLsnMode: input.pullContinuation?.commitLsnMode,
    plan,
  });
  if (input.stillCurrent?.() === false) {
    return { kind: "completed", result: null };
  }
  if (!submitted) {
    return { kind: "completed", result: null };
  }
  if (!submitted.ok) {
    if (
      await handleUpstreamDeletedDocumentSyncFailure({
        documentId: input.documentId,
        failure: submitted,
        onRemoteDocumentDeleted: input.onRemoteDocumentDeleted,
      })
    ) {
      return { kind: "completed", result: null };
    }

    if (isRetryableDocumentSyncConflict(submitted)) {
      traceSubmitFailed(input.onSyncTrace, {
        action: "retry",
        code: submitted.code,
        documentId: input.documentId,
        status: submitted.status,
      });
      assertRawContinuationCanRetry(input.historyMode, input.pullContinuation);
      return { kind: "not_completed" };
    }

    traceSubmitFailed(input.onSyncTrace, {
      action: "stop",
      code: submitted.code,
      documentId: input.documentId,
      status: submitted.status,
    });
    submitted.report();
    return { kind: "completed", result: null };
  }

  if (submitted.response.updates.length > 0) {
    return completeReadOnlyRemoteDocumentSyncWithUpdates({
      ...input,
      pullComplete: submitted.pullComplete,
      response: submitted.response,
    });
  }

  try {
    const persistedState = await persistedDocumentSyncStateFromResponse(
      plan,
      submitted.response,
      { resolveWriterPublicKey: input.resolveWriterPublicKey },
    );

    return {
      kind: "completed",
      result: {
        contentKey: new Uint8Array(),
        decryptedUpdates: [],
        exhaustedPendingUpdateCount: 0,
        hasDeferredPendingUpdates: false,
        hasIncompletePull: !submitted.pullComplete,
        persistedState,
        plan,
        rekeyedPendingUpdateIds: [],
        response: submitted.response,
        settledPendingUpdateIds: [],
        acceptedRecoveryBaseline: false,
      },
    };
  } catch (error) {
    if (input.historyMode === "raw") {
      throw error;
    }
    return { kind: "not_completed" };
  }
}

export interface SyncRemoteDocumentInput {
  apiClient: DocumentSyncApi;
  author: DocumentCreateAuthor;
  /**
   * Supplies a full-history Loro snapshot of the local document so a
   * write-bearing pass can heal a stale content-key bundle by rotating to a
   * fresh content key anchored by a rotation baseline.
   */
  buildRotationSnapshot?: (() => Promise<Uint8Array | null>) | undefined;
  /** Rebuilds inline rekey plans against each submission's current projection. */
  buildContainerRekeys?: DocumentSyncContainerRekeyBuilder;
  documentId: string;
  execSql: ExecSql;
  /** Explicit read-only recovery that bypasses rotation-baseline redirect. */
  historyMode?: "raw" | undefined;
  isRemoteSyncBlocked?: ((organizationId: string) => boolean) | undefined;
  localVersionVector: string | null;
  minLsn?: string | undefined;
  pullContinuation?: DocumentSyncPullContinuation | undefined;
  /** Atomically commits the verified purge proof with matching local teardown. */
  onRemoteDocumentDeleted?: RemoteDocumentDeletionHandler | undefined;
  onSyncAbandoned?: ((reason: string) => void) | undefined;
  /** Clipboard-safe trace sink (see syncTrace.ts); never receives content. */
  onSyncTrace?: DocumentSyncTraceEmitter | undefined;
  /**
   * Fires when a pass WITHOUT queued writes cannot resolve its writer
   * projection (e.g. a coded 409 from the projection route). Read-only
   * revalidation otherwise fails silently — one burned request and a trace
   * line — leaving the document permanently stale with nothing durable to
   * explain why (edge-case row 13).
   */
  onReadOnlyProjectionFailure?: TerminalSubmitFailureHandler | undefined;
  /** Records a verified response update that could not be decrypted/imported. */
  onIncomingUpdateIsolationFailure?:
    | ((failure: DocumentSyncUpdateIsolationError) => void | Promise<void>)
    | undefined;
  /** Fires immediately before a materialized outgoing batch is submitted. */
  onOutgoingUpdatesMaterialized?:
    | ((updateIds: readonly string[]) => void)
    | undefined;
  /** Invalidates continuation state after the server rejects its snapshot. */
  onPullContinuationInvalidated?:
    | ((continuation: DocumentSyncPullContinuation) => void | Promise<void>)
    | undefined;
  onTerminalSubmitFailure?: TerminalSubmitFailureHandler | undefined;
  pendingUpdates?: readonly PendingUpdateRecord[] | undefined;
  persistedState?: PersistedDocumentSyncState | null | undefined;
  rekeyPendingUpdate?: RekeyPendingUpdate | undefined;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  resolveWriterPublicKey: DocumentWriterPublicKeyResolver;
  signedAt?: string | undefined;
  stillCurrent?: (() => boolean) | undefined;
  targetSecretKey: Uint8Array;
  /** Validates decrypted updates against scratch state before callers persist. */
  validateIncomingUpdates: IncomingDocumentSyncUpdateValidator;
  warmReferencedPrincipalPolicies?: ReferencedPrincipalPolicyWarmer | undefined;
  writerProjection?: DocumentWriterProjectionResponse | undefined;
}

export async function tryPersistedReadOnlyDocumentSync(
  input: SyncRemoteDocumentInput,
  resolveProjectionUserKey: ProjectionUserKeyResolver,
): Promise<PersistedReadOnlyDocumentSyncResult | null> {
  if (input.stillCurrent?.() === false) return null;
  if ((input.pendingUpdates ?? []).length > 0) return null;

  return syncReadOnlyRemoteDocumentFromPersistedState({
    ...input,
    resolveProjectionUserKey,
  });
}
