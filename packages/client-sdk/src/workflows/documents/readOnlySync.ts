import { KeyingVerificationError } from "@symcrypt/crypto";
import type {
  DocumentCreateResponse,
  DocumentSyncResponse,
  DocumentWriterProjectionResponse,
} from "@symcrypt/validators/response";
import {
  isAccessManifestBundleWireResponse,
  isDocumentContentKeyBundleResponse,
  isDocumentKekTargetsResponse,
} from "@symcrypt/validators/response";
import {
  isRetryableDocumentSyncConflict,
  persistedDocumentSyncStateFromResponse,
  submitDocumentSync,
} from "../../data/documents/shared/responses";
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
import { rethrowKeyingVerificationError } from "../../data/keyingProjectionVerification/error";
import type { PendingUpdateRecord } from "../../data/sqlite/documentPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import {
  handleUpstreamDeletedDocumentSyncFailure,
  projectionIntegrityErrorCode,
  type RemoteDocumentDeletionHandler,
  type TerminalSubmitFailureHandler,
} from "./syncFailureClassification";
import { resolveSyncAttemptWriterProjection } from "./syncFailures";
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
    localVersionVector: input.localVersionVector,
    minLsn: input.minLsn,
    onSyncTrace: input.onSyncTrace,
    pendingUpdates: [],
    signedAt: input.signedAt,
    targetSecretKey: input.targetSecretKey,
    writerProjection: input.writerProjection,
    ...projectionVerificationOptions(input),
  });

  return syncRemoteDocumentResultFromResponse({
    ...projectionVerificationOptions(input),
    execSql: input.execSql,
    materializedPlan,
    recoveryPendingUpdatesById: new Map(),
    resolveWriterPublicKey: input.resolveWriterPublicKey,
    response: input.response,
    targetSecretKey: input.targetSecretKey,
    writerProjection: input.writerProjection,
    resolveProjectionUserKey: input.resolveProjectionUserKey,
  });
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
  localVersionVector: string | null;
  minLsn?: string | undefined;
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

  return buildDocumentSyncPlan({
    author: input.author,
    contentKeyBundle: persisted.contentKeyBundle,
    documentId: input.documentId,
    documentKekTargets: persisted.documentKekTargets,
    documentManifest: persisted.documentManifest,
    localVersionVector: input.localVersionVector,
    minLsn: input.minLsn,
    outgoingUpdates: [],
    signedAt: input.signedAt,
  });
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
  localVersionVector: string | null;
  minLsn?: string | undefined;
  onReadOnlyProjectionFailure?: TerminalSubmitFailureHandler | undefined;
  onRemoteDocumentDeleted?: RemoteDocumentDeletionHandler | undefined;
  onSyncTrace?: DocumentSyncTraceEmitter | undefined;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  resolveWriterPublicKey: DocumentWriterPublicKeyResolver;
  response: DocumentSyncResponse;
  signedAt?: string | undefined;
  targetSecretKey: Uint8Array;
  warmReferencedPrincipalPolicies?: ReferencedPrincipalPolicyWarmer | undefined;
  writerProjection?: DocumentWriterProjectionResponse | undefined;
}

async function tryCompleteReadOnlyRemoteDocumentSyncWithProjection(input: {
  allowCachedProjectionRefresh: boolean;
  completion: ReadOnlyDocumentSyncCompletionInput;
  writerProjection: DocumentWriterProjectionResponse;
}): Promise<SyncRemoteDocumentResult | null> {
  try {
    return await completeReadOnlyRemoteDocumentSyncWithProjection({
      ...input.completion,
      writerProjection: input.writerProjection,
    });
  } catch (error) {
    if (
      input.allowCachedProjectionRefresh &&
      error instanceof KeyingVerificationError &&
      error.code === "invalid_shape"
    ) {
      return null;
    }
    // The document-store `document.sync` boundary owns durable reporting; this
    // helper only decides whether an ordinary projection miss is retryable.
    rethrowKeyingVerificationError(error);
    if (projectionIntegrityErrorCode(error)) {
      throw error;
    }
    return null;
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
      // Read-only by construction: this path only runs on passes with no
      // queued writes, so a refused fetch records durably (row 13).
      onTerminalFailure: input.onReadOnlyProjectionFailure,
      reusableWriterProjection: null,
    }));
  if (!writerProjection) {
    return { kind: "completed", result: null };
  }

  let result: SyncRemoteDocumentResult | null = null;
  let retryAfterRollback = false;
  try {
    result = await tryCompleteReadOnlyRemoteDocumentSyncWithProjection({
      allowCachedProjectionRefresh: Boolean(reusableWriterProjection),
      completion: input,
      writerProjection,
    });
  } catch (error) {
    if (projectionIntegrityErrorCode(error) !== "rollback") {
      throw error;
    }
    retryAfterRollback = true;
  }
  if (result || (!retryAfterRollback && !reusableWriterProjection)) {
    return { kind: "completed", result };
  }

  if (input.apiClient.evictDocumentWriterProjection) {
    input.apiClient.evictDocumentWriterProjection(input.documentId);
  } else {
    input.apiClient.clearWriterProjectionCaches?.();
  }
  const freshWriterProjection = await resolveSyncAttemptWriterProjection({
    apiClient: input.apiClient,
    documentId: input.documentId,
    onRemoteDocumentDeleted: input.onRemoteDocumentDeleted,
    onSyncTrace: input.onSyncTrace,
    onTerminalFailure: input.onReadOnlyProjectionFailure,
    reusableWriterProjection: null,
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
  return freshResult
    ? { kind: "completed", result: freshResult }
    : { kind: "not_completed" };
}

async function syncReadOnlyRemoteDocumentFromPersistedState(
  input: Omit<ReadOnlyDocumentSyncCompletionInput, "response"> & {
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

  const submitted = await submitDocumentSync({
    apiClient: input.apiClient,
    plan,
  });
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
        persistedState,
        plan,
        rekeyedPendingUpdateIds: [],
        response: submitted.response,
        settledPendingUpdateIds: [],
        acceptedRecoveryBaseline: false,
      },
    };
  } catch {
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
  documentId: string;
  execSql: ExecSql;
  isRemoteSyncBlocked?: ((organizationId: string) => boolean) | undefined;
  localVersionVector: string | null;
  minLsn?: string | undefined;
  onRemoteDocumentDeleted?: RemoteDocumentDeletionHandler | undefined;
  // Receives the reason whenever this sync returns null, so callers that
  // convert a null result into their own error can name the real cause.
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
  onTerminalSubmitFailure?: TerminalSubmitFailureHandler | undefined;
  pendingUpdates?: readonly PendingUpdateRecord[] | undefined;
  persistedState?: PersistedDocumentSyncState | null | undefined;
  rekeyPendingUpdate?: RekeyPendingUpdate | undefined;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  resolveWriterPublicKey: DocumentWriterPublicKeyResolver;
  signedAt?: string | undefined;
  targetSecretKey: Uint8Array;
  warmReferencedPrincipalPolicies?: ReferencedPrincipalPolicyWarmer | undefined;
  writerProjection?: DocumentWriterProjectionResponse | undefined;
}

export async function tryPersistedReadOnlyDocumentSync(
  input: SyncRemoteDocumentInput,
  resolveProjectionUserKey: ProjectionUserKeyResolver,
): Promise<PersistedReadOnlyDocumentSyncResult | null> {
  if ((input.pendingUpdates ?? []).length > 0) {
    return null;
  }

  return syncReadOnlyRemoteDocumentFromPersistedState({
    ...input,
    resolveProjectionUserKey,
  });
}
