import { createReadOnlyDocument, isLoroRuntimeFailure } from "@tearleads/loro";
import { DOCUMENTS_APP_KIND } from "../../../data/documents/documentConstants";
import type { DocumentProjectorRegistryInput } from "../../../data/documents/documentKinds";
import { processLoroRuntimeFailures } from "../../../data/documents/shared/sync/loroRuntimeFailureLedger";
import { resolveDocumentCreateAuthor } from "../author";
import { mergePersistedDocumentHistory } from "../historyContent";
import { defaultDocumentsPersistence } from "../persistence";
import type { DocumentsWorkflowRuntime } from "../runtime";
import { readDocumentSyncPageLimit } from "../sync/loroWindows";
import {
  type DocumentHistory,
  type DocumentHistoryVersion,
  replayDocumentHistory,
} from "./documentHistory";
import { compareDocumentHistories } from "./documentHistoryComparison";
import {
  creditDocumentHistoryUpdates,
  type DocumentHistoryVerifiedRange,
} from "./documentHistoryProvenance";
import {
  type DocumentHistoryVerificationProgress,
  type DocumentHistoryVerificationUnavailable,
  type DrainedDocumentHistory,
  drainSignedDocumentHistory,
  historyVerificationUnavailable,
} from "./documentHistoryRawPull";

export interface DocumentHistoryVerificationOptions {
  /** Called after each page of the server's history is read and judged. */
  readonly onProgress?:
    | ((progress: DocumentHistoryVerificationProgress) => void)
    | undefined;
  /** Stops the verification between pages; it then ends `interrupted`. */
  readonly signal?: AbortSignal | undefined;
}

/** What a completed verification found. */
export interface DocumentHistoryVerificationReport {
  /**
   * The version of this device's durable history that was compared, as
   * `DocumentHistory.versionAt` reports one. Its entries are in no set
   * order. A replay opened from the same durable history ends at this
   * version; one that does not was captured before or after it.
   */
  readonly localVersion: DocumentHistoryVersion;
  /**
   * Who first uploaded each operation of the server's history. An operation
   * no range covers is not in that history: this device has not sent it, or
   * the server no longer serves it.
   */
  readonly ranges: ReadonlyArray<DocumentHistoryVerifiedRange>;
  /** The server's history holds operations this device has not stored. */
  readonly serverAhead: boolean;
  /** Served updates this device's judge left out of the rebuild. */
  readonly voidUpdateCount: number;
}

/**
 * The outcome of checking a document's durable local history against the
 * signed updates the server retains.
 *
 * - `verified`: wherever both hold an operation, this device's copy is the
 *   signed one, operation for operation and commit time for commit time.
 * - `mismatch`: some operation differs. `signed` replays the history rebuilt
 *   from the signed updates; the caller must `close()` it.
 * - `unavailable`: no verdict was reached, for `reason`.
 */
export type DocumentHistoryVerification =
  | (DocumentHistoryVerificationReport & { readonly status: "verified" })
  | (DocumentHistoryVerificationReport & {
      readonly signed: DocumentHistory;
      readonly status: "mismatch";
    })
  | DocumentHistoryVerificationUnavailable;

type HistoryDocument = ReturnType<typeof createReadOnlyDocument>;

/** A document's version as the operations that head it. */
function documentHistoryVersion(doc: HistoryDocument): DocumentHistoryVersion {
  return doc
    .vvToFrontiers(doc.oplogVersion())
    .map(({ counter, peer }) => ({ counter, peerId: peer }));
}

/**
 * Compares the rebuilt history with the device's own and reports the
 * verdict. A mismatch hands `signed` to the replay it returns.
 */
function reportHistoryVerification(input: {
  readonly documentProjectors: DocumentProjectorRegistryInput;
  readonly drained: DrainedDocumentHistory;
  readonly local: HistoryDocument;
  readonly signed: HistoryDocument;
}): DocumentHistoryVerification {
  const comparison = compareDocumentHistories(input);
  const report: DocumentHistoryVerificationReport = {
    localVersion: documentHistoryVersion(input.local),
    ranges: creditDocumentHistoryUpdates(input.drained.credited),
    serverAhead: comparison.serverAhead,
    voidUpdateCount: input.drained.voidUpdateCount,
  };
  if (comparison.matches) return { ...report, status: "verified" };
  return {
    ...report,
    signed: replayDocumentHistory(input.signed, input.documentProjectors),
    status: "mismatch",
  };
}

/**
 * Check a synced document's durable local history against the signed updates
 * the server retains. The whole raw history is pulled from a null version,
 * every update is authenticated and judged as a sync pass judges it, the
 * accepted ones are rebuilt in a scratch document, and the rebuild is
 * compared with the local history on the operations both hold.
 *
 * It reads beside the live document, never through it: it runs outside the
 * sync lane and both write chains, records no void, attempt, cursor, or sync
 * failure, and writes only Loro read-window rows, its own being removed when
 * their page is done. It does not claim the windows ended processes left,
 * which would record attempts. A window an ended verification left counts
 * toward nothing; the next sync pass of the document removes it. A scope
 * already reading suspects alone is left to it: the outcome is `unsettled`
 * and nothing is read. Recorded import voids are judged again from raw
 * history, since this device may have reached them from a rotation
 * baseline; a void the payload alone decides, or one this device's runtime
 * failed for good, stands.
 *
 * Expected outcomes come back as a status. A failure that is none of them,
 * such as a database error, is thrown.
 */
export async function verifyDocumentHistory(input: {
  readonly localId: string;
  readonly options?: DocumentHistoryVerificationOptions | undefined;
  readonly runtime: DocumentsWorkflowRuntime;
  readonly stillCurrent: () => boolean;
}): Promise<DocumentHistoryVerification> {
  const { localId, runtime } = input;
  const { execSql } = runtime.infra;
  const signal = input.options?.signal;
  const stillCurrent = () => input.stillCurrent() && signal?.aborted !== true;
  const record = await defaultDocumentsPersistence.loadDocument(
    execSql,
    localId,
  );
  if (!record?.documentId) return historyVerificationUnavailable("not_synced");
  const { documentId } = record;
  const author = resolveDocumentCreateAuthor(runtime);
  const keys = runtime.crypto.encapsulationKeyPair;
  if (!author || !keys || !runtime.state.online) {
    return historyVerificationUnavailable("offline");
  }
  if (!stillCurrent()) return historyVerificationUnavailable("interrupted");
  const scope = { appKind: DOCUMENTS_APP_KIND, localId };
  // A scope isolating suspects reads them one a page, alone in its
  // lifetime. A whole-history read beside it would take that from it.
  if ((await readDocumentSyncPageLimit(execSql, { documentId, scope })) === 1) {
    return historyVerificationUnavailable("unsettled");
  }
  const local = createReadOnlyDocument();
  const signed = createReadOnlyDocument();
  let signedHandedOn = false;
  try {
    // The durable history, never the document a store is editing.
    await mergePersistedDocumentHistory({
      doc: local,
      execSql,
      localId,
      persistence: defaultDocumentsPersistence,
    });
    const drained = await drainSignedDocumentHistory({
      author,
      documentId,
      onProgress: input.options?.onProgress,
      record,
      runtime,
      scope,
      secretKey: keys.secretKey,
      signed,
      stillCurrent,
    });
    if (drained.status === "unavailable") return drained;
    if (drained.servedUpdateCount === 0) {
      return historyVerificationUnavailable("not_synced");
    }
    if (!stillCurrent()) return historyVerificationUnavailable("interrupted");
    const verification = reportHistoryVerification({
      documentProjectors: runtime.infra.documentProjectors,
      drained,
      local,
      signed,
    });
    signedHandedOn = verification.status === "mismatch";
    return verification;
  } catch (error) {
    if (!isLoroRuntimeFailure(error)) throw error;
    // The module may be unusable now: the process is marked failed, as a
    // failure applying a page marks it.
    processLoroRuntimeFailures.noteUnattributedFailure();
    return historyVerificationUnavailable("unsettled");
  } finally {
    local.free();
    if (!signedHandedOn) signed.free();
  }
}
