import { KeyingVerificationError } from "@tearleads/crypto";
import {
  type createReadOnlyDocument,
  isLoroRuntimeFailure,
} from "@tearleads/loro";
import { readWriteHeader } from "../../../data/documents/shared/readers";
import { isDocumentBaselineSegment } from "../../../data/documents/shared/sync/baselineSegment";
import type { SyncRemoteDocumentResult } from "../../../data/documents/shared/sync/documentSyncTypes";
import { importLiveDocumentSyncUpdates } from "../../../data/documents/shared/sync/documentSyncUpdateImport";
import { isDocumentSyncUpdateIsolationError } from "../../../data/documents/shared/sync/documentSyncUpdateIsolation";
import type {
  DocumentSyncImportVerdicts,
  DocumentVoidStage,
} from "../../../data/documents/shared/sync/documentUpdateVerdict";
import {
  type DocumentSyncPullContinuation,
  InvalidDocumentSyncPullContinuationError,
  readPullContinuation,
} from "../../../data/documents/shared/sync/syncPagination";
import type {
  DocumentRecord,
  DocumentScope,
} from "../../../data/persistence/documents/records";
import { ProjectionDependencyUnavailableError } from "../../../data/shared/dependencyUnavailable";
import type { resolveDocumentCreateAuthor } from "../author";
import { createDocumentProjectionUserKeyResolver } from "../projectionKeys";
import { RemoteDocumentService } from "../remote/remoteDocumentService";
import type { DocumentsWorkflowRuntime } from "../runtime";
import {
  createDocumentSyncLoroWindow,
  type DocumentSyncLoroWindow,
  runDocumentSyncLoroWork,
  settleDocumentSyncLoroWindow,
} from "../sync/loroPassWindow";
import { judgeUnrecordedDocumentSyncImports } from "../sync/unrecordedImports";
import { DocumentRawHistoryUnavailableError } from "../syncPlan/syncContentKeys";
import { createDocumentWriterPublicKeyResolver } from "../writerKeys";
import type { CreditedHistoryUpdate } from "./documentHistoryProvenance";

/**
 * The most updates a document's server history may hold for this device to
 * verify it. It matches the bound a reader pages edit-attribution ranges to.
 */
export const MAX_VERIFIED_HISTORY_UPDATES = 20_000;

/**
 * How many pages in a row may serve no update while promising more. One may
 * be honest; a server that keeps doing it would hold the verification open
 * for ever without ever reaching the update cap.
 */
export const MAX_EMPTY_HISTORY_PAGES = 4;

/** How far a verification has read. */
export interface DocumentHistoryVerificationProgress {
  /** Updates read and judged so far. */
  readonly updatesRead: number;
  /** Updates the server holds for the document, as its first page said. */
  readonly updatesTotal: number;
}

/** Why a verification reached no verdict. Each leaves the device as it was. */
export type DocumentHistoryVerificationUnavailable =
  | {
      /**
       * `offline`: no network, keys, or signed-in author. `not_synced`: the
       * document has no remote record, or the server holds no update of it.
       * `rejected`: a served page failed a signature or integrity check.
       * `unsettled`: this device could not finish reading the history (a
       * Loro runtime failure, an update the judge held behind one or
       * deferred past its rebuild budget, or a scope reading suspects
       * alone). `too_large`: the history holds more than
       * `MAX_VERIFIED_HISTORY_UPDATES` updates. `interrupted`: the signal
       * aborted, the scope changed, or a request, or material a check
       * needed, did not arrive.
       */
      readonly reason:
        | "interrupted"
        | "not_synced"
        | "offline"
        | "rejected"
        | "too_large"
        | "unsettled";
      readonly status: "unavailable";
    }
  | {
      /** The content-key epoch whose key this device cannot reach. */
      readonly contentKeyEpoch: number;
      readonly error: DocumentRawHistoryUnavailableError;
      readonly reason: "epoch_key_unreachable";
      readonly status: "unavailable";
    };

type PlainUnavailableReason = Exclude<
  DocumentHistoryVerificationUnavailable["reason"],
  "epoch_key_unreachable"
>;

export function historyVerificationUnavailable(
  reason: PlainUnavailableReason,
): DocumentHistoryVerificationUnavailable {
  return { reason, status: "unavailable" };
}

/** A server history drained whole into the scratch document. */
export interface DrainedDocumentHistory {
  /** The accepted updates, in server order. */
  readonly credited: readonly CreditedHistoryUpdate[];
  readonly servedUpdateCount: number;
  readonly status: "drained";
  readonly voidUpdateCount: number;
}

interface HistoryDrainInput {
  readonly author: NonNullable<ReturnType<typeof resolveDocumentCreateAuthor>>;
  readonly documentId: string;
  readonly onProgress:
    | ((progress: DocumentHistoryVerificationProgress) => void)
    | undefined;
  readonly record: DocumentRecord;
  readonly runtime: DocumentsWorkflowRuntime;
  readonly scope: DocumentScope;
  readonly secretKey: Uint8Array;
  /** The empty scratch document the signed history is rebuilt in. */
  readonly signed: ReturnType<typeof createReadOnlyDocument>;
  readonly stillCurrent: () => boolean;
}

/** What the pages read so far add up to. */
interface HistoryDrainTally {
  readonly credited: CreditedHistoryUpdate[];
  served: number;
  total: number | null;
  voided: number;
}

interface HistoryPageRequest {
  readonly continuation: DocumentSyncPullContinuation | undefined;
  readonly planningRecord: DocumentRecord;
  readonly writerProjection: SyncRemoteDocumentResult["writerProjection"];
}

/**
 * A recorded void every reader of the update reaches: its payload alone
 * decides it, or this device's runtime failed it for good. An import void
 * was decided against the history this device held, which may have started
 * from a rotation baseline, so the verifier judges it again from raw history.
 */
function honorsRecordedVoid(stage: DocumentVoidStage): boolean {
  return stage !== "loro_import";
}

function isSettled(verdicts: DocumentSyncImportVerdicts | null): boolean {
  return (
    verdicts === null ||
    (verdicts.runtimeFailures.length === 0 &&
      verdicts.heldUpdateIds.length === 0 &&
      verdicts.deferredUpdateIds.length === 0)
  );
}

/**
 * The outcome a failed read stands for, or null for a failure that is no
 * expected outcome. Poison outranks an unreachable key before either gets
 * here (`throwRawHistoryUnavailable`).
 */
function unavailableForFailure(
  error: unknown,
): DocumentHistoryVerificationUnavailable | null {
  if (error instanceof DocumentRawHistoryUnavailableError) {
    return {
      contentKeyEpoch: error.contentKeyEpoch,
      error,
      reason: "epoch_key_unreachable",
      status: "unavailable",
    };
  }
  if (isLoroRuntimeFailure(error)) {
    return historyVerificationUnavailable("unsettled");
  }
  if (isDocumentSyncUpdateIsolationError(error)) {
    return historyVerificationUnavailable(
      error.stage === "loro_runtime" || error.stage === "decrypt_runtime"
        ? "unsettled"
        : "rejected",
    );
  }
  // Material this device lacks, such as a referenced policy it could not
  // fetch, is no evidence against the server.
  if (
    error instanceof ProjectionDependencyUnavailableError ||
    (error instanceof KeyingVerificationError &&
      error.code === "missing_dependency")
  ) {
    return historyVerificationUnavailable("interrupted");
  }
  if (
    error instanceof KeyingVerificationError ||
    error instanceof InvalidDocumentSyncPullContinuationError
  ) {
    return historyVerificationUnavailable("rejected");
  }
  return null;
}

/** The accepted updates of a page, as their verified headers declare them. */
function creditedPageUpdates(
  synced: SyncRemoteDocumentResult,
): CreditedHistoryUpdate[] {
  const served = new Map(
    synced.response.updates.map((update) => [update.id, update]),
  );
  return synced.decryptedUpdates.flatMap((update) => {
    const response = served.get(update.id);
    if (response === undefined) return [];
    const header = readWriteHeader(
      response.writeHeader,
      "Document history update write header",
    );
    return [
      {
        authorityKind: isDocumentBaselineSegment(update)
          ? "baseline"
          : "direct",
        createdAt: response.createdAt,
        partialEndVersionVector: update.partialEndVersionVector,
        partialStartVersionVector: update.partialStartVersionVector,
        signedAt: header.signedAt,
        updateId: update.id,
        writerKeyFingerprint: header.writerKeyFingerprint,
        writerUserId: header.writerUserId,
      },
    ];
  });
}

/**
 * Pulls one raw page and judges it inside `loroWindow`. It passes no
 * deletion, abandon, isolation, or terminal-failure handler, so the pass
 * records nothing about the document.
 */
async function pullJudgedHistoryPage(
  input: HistoryDrainInput,
  request: HistoryPageRequest,
  loroWindow: DocumentSyncLoroWindow,
) {
  const { documentId, runtime, scope } = input;
  const { execSql } = runtime.infra;
  const judged: { verdicts: DocumentSyncImportVerdicts | null } = {
    verdicts: null,
  };
  const synced = await new RemoteDocumentService({
    api: runtime.apiClient,
    encapsulationSecretKey: input.secretKey,
    execSql,
    isRemoteSyncBlocked: runtime.util.isRemoteSyncBlocked,
  }).syncRemoteDocument({
    author: input.author,
    documentId,
    historyMode: "raw",
    localVersionVector: null,
    minLsn: input.record.lastCommitLsn ?? undefined,
    pendingUpdates: [],
    persistedState: request.planningRecord,
    pullContinuation: request.continuation,
    resolveProjectionUserKey: createDocumentProjectionUserKeyResolver(runtime),
    resolveWriterPublicKey: createDocumentWriterPublicKeyResolver({
      logPrefix: "Documents",
      runtime,
      writerKeyLabel: "writer key",
    }),
    stillCurrent: input.stillCurrent,
    validateIncomingUpdates: async (result) => {
      judged.verdicts = await judgeUnrecordedDocumentSyncImports({
        currentDocument: input.signed,
        documentId,
        execSql,
        honorKnownVoid: honorsRecordedVoid,
        loroWindow,
        reads: { kind: "history" },
        result,
        scope,
      });
      return judged.verdicts;
    },
    warmReferencedPrincipalPolicies: runtime.principalPolicies.createWarmer(),
    writerProjection: request.writerProjection,
  });
  return { synced, verdicts: judged.verdicts };
}

/**
 * Reads one page into the rebuild: pulls and judges it, refuses a history
 * past the cap before importing anything of it, and imports what the judge
 * accepted. The page's Loro work runs in a `history` window of its own,
 * settled before the next page is asked for, so a scope waiting to read
 * suspects alone waits at most one page.
 */
async function readHistoryPage(
  input: HistoryDrainInput,
  request: HistoryPageRequest,
  tally: HistoryDrainTally,
): Promise<
  | { readonly status: "read"; readonly synced: SyncRemoteDocumentResult }
  | DocumentHistoryVerificationUnavailable
> {
  const loroWindow = createDocumentSyncLoroWindow();
  try {
    const { synced, verdicts } = await pullJudgedHistoryPage(
      input,
      request,
      loroWindow,
    );
    if (!synced || !input.stillCurrent()) {
      return historyVerificationUnavailable("interrupted");
    }
    if (synced.hasHeldPull || !isSettled(verdicts)) {
      return historyVerificationUnavailable("unsettled");
    }
    tally.served += synced.response.updates.length;
    tally.total ??= synced.response.pullPage?.throughUpdateCount ?? 0;
    if (Math.max(tally.total, tally.served) > MAX_VERIFIED_HISTORY_UPDATES) {
      return historyVerificationUnavailable("too_large");
    }
    tally.voided += synced.voidedUpdates.length;
    // Exactly what a sync pass applies: every accepted served update,
    // checkpoints included. A runtime failure marks the process failed.
    runDocumentSyncLoroWork(loroWindow, () =>
      importLiveDocumentSyncUpdates(input.signed, synced.decryptedUpdates),
    );
    tally.credited.push(...creditedPageUpdates(synced));
    return { status: "read", synced };
  } catch (error) {
    const unavailable = unavailableForFailure(error);
    if (unavailable === null) throw error;
    return unavailable;
  } finally {
    await settleDocumentSyncLoroWindow(loroWindow, null);
  }
}

/** Where the next page starts, or null when the page names no valid cursor. */
function nextHistoryPage(
  synced: SyncRemoteDocumentResult,
): DocumentSyncPullContinuation | null {
  try {
    return readPullContinuation(synced.response, synced.baselineGroupRun);
  } catch {
    return null;
  }
}

/**
 * Drains the server's raw history from a null version into `input.signed`,
 * authenticating and judging every page as a sync pass does. The cursor and
 * each page's verified projection state stay in memory. Expected failures
 * come back as an `unavailable` outcome; nothing is recorded either way.
 */
export async function drainSignedDocumentHistory(
  input: HistoryDrainInput,
): Promise<DrainedDocumentHistory | DocumentHistoryVerificationUnavailable> {
  const tally: HistoryDrainTally = {
    credited: [],
    served: 0,
    total: null,
    voided: 0,
  };
  const seenCursors = new Set<string>();
  let emptyPages = 0;
  let request: HistoryPageRequest = {
    continuation: undefined,
    planningRecord: input.record,
    writerProjection: undefined,
  };
  while (true) {
    if (!input.stillCurrent()) {
      return historyVerificationUnavailable("interrupted");
    }
    const page = await readHistoryPage(input, request, tally);
    if (page.status === "unavailable") return page;
    const { synced } = page;
    input.onProgress?.({
      updatesRead: tally.served,
      updatesTotal: Math.max(tally.total ?? 0, tally.served),
    });
    if (!synced.hasIncompletePull) break;
    emptyPages = synced.response.updates.length === 0 ? emptyPages + 1 : 0;
    const continuation = nextHistoryPage(synced);
    // A server with more to serve names where; a cursor it repeats, or a
    // run of pages that serve nothing, would hold the read open for ever.
    if (
      !continuation ||
      seenCursors.has(continuation.cursor) ||
      emptyPages > MAX_EMPTY_HISTORY_PAGES
    ) {
      return historyVerificationUnavailable("rejected");
    }
    seenCursors.add(continuation.cursor);
    request = {
      continuation,
      planningRecord: { ...request.planningRecord, ...synced.persistedState },
      writerProjection: synced.writerProjection,
    };
  }
  return {
    credited: tally.credited,
    servedUpdateCount: tally.served,
    status: "drained",
    voidUpdateCount: tally.voided,
  };
}
