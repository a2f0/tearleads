import type { SyncRemoteDocumentResult } from "../../../data/documents/shared/sync/documentSyncTypes";
import { optionalHeaderEpoch } from "../../../data/documents/shared/sync/documentSyncUpdateIsolation";
import { documentVerdictJudge } from "../../../data/documents/shared/sync/documentUpdateVerdict";
import {
  type LoroLifetimes,
  processLoroLifetimes,
} from "../../../data/documents/shared/sync/loroLifetime";
import {
  type LoroRuntimeAttempts,
  MAX_LORO_RUNTIME_ATTEMPTS,
} from "../../../data/documents/shared/sync/loroRuntimeFailureLedger";
import {
  judgeOrphanWindow,
  type LoroIsolation,
  type LoroWindow,
  loroIsolationPageLimit,
  loroWindowCounts,
  type OrphanVerdict,
  transitionLoroIsolation,
} from "../../../data/documents/shared/sync/loroWindowMachine";
import type { DocumentScope } from "../../../data/persistence/documents/records";
import { ensureDocumentTables } from "../../../data/persistence/documents/records";
import {
  readRecordedImportVoids,
  recordDocumentSyncVerdictsInTransaction,
} from "../../../data/persistence/documents/records/documentSyncVerdictPersistence";
import {
  deleteLoroWindowInTransaction,
  markLoroWindowsNotCountingInTransaction,
  readForeignLoroWindows,
  readLoroIsolation,
  writeLoroIsolationInTransaction,
  writeLoroWindowInTransaction,
} from "../../../data/persistence/documents/records/loroWindowPersistence";
import { getClientSQLitePersistenceRuntime } from "../../../data/sqlite/sqlitePersistenceRuntime";
import {
  type ExecSql,
  runSerializedSqlMutation,
} from "../../../data/sqlite/sqlSchema";
import type { WorkflowRuntimeUtilInput } from "../../shared/runtimeInput";

/**
 * Loro read windows for a document's sync pages (#3194). A page's reads of
 * served payloads run inside a window committed before the first Loro call
 * and deleted by the page's save, so a process that dies inside it leaves
 * the window for its next lifetime to find.
 */

const KILLED_MESSAGE = "The process ended while reading this update";

type PageResult = Pick<
  SyncRemoteDocumentResult,
  "contentKeyFingerprintsByEpoch" | "decryptedUpdates" | "response"
>;

interface WindowScopeInput {
  readonly execSql: ExecSql;
  /** @internal This realm's lifetime; tests stand in another one. */
  readonly lifetimes?: LoroLifetimes | undefined;
  readonly scope: DocumentScope;
}

/** The scopes each lifetime holds a window on, so a close knows its own. */
const openScopes = new WeakMap<LoroLifetimes, Set<string>>();

function scopeKey(scope: DocumentScope): string {
  return `${scope.appKind}\u0000${scope.localId}`;
}

function scopesOf(lifetimes: LoroLifetimes): Set<string> {
  let scopes = openScopes.get(lifetimes);
  if (!scopes) {
    scopes = new Set();
    openScopes.set(lifetimes, scopes);
  }
  return scopes;
}

type ClaimTransaction = Parameters<
  Parameters<
    ReturnType<typeof getClientSQLitePersistenceRuntime>["guardedTransaction"]
  >[0]
>[0];

interface OrphanClaim {
  readonly documentId: string;
  readonly judge: string;
  readonly scope: DocumentScope;
}

/** Records one more `loro_runtime` attempt toward the update a death held. */
async function countOrphanAttemptInTransaction(
  tx: ClaimTransaction,
  claim: OrphanClaim,
  verdict: Extract<OrphanVerdict, { kind: "count" }>,
): Promise<number> {
  const [recorded] = await readRecordedImportVoids(tx, {
    judge: claim.judge,
    scope: claim.scope,
    updateIds: [verdict.updateId],
  });
  const sameKey =
    recorded?.stage === "loro_runtime" &&
    recorded.keyFingerprint === verdict.keyFingerprint;
  const attempts = (sameKey ? (recorded.attempts ?? 0) : 0) + 1;
  const { contentKeyEpoch, keyFingerprint } = verdict;
  await recordDocumentSyncVerdictsInTransaction(tx, {
    acceptedUpdateIds: [],
    documentId: claim.documentId,
    judge: claim.judge,
    keyFingerprintsByEpoch:
      contentKeyEpoch === null || keyFingerprint === null
        ? new Map()
        : new Map([[contentKeyEpoch, keyFingerprint]]),
    now: new Date().toISOString(),
    resolvesKeyConflicts: false,
    scope: claim.scope,
    voids: [
      {
        attempts,
        contentKeyEpoch,
        message: KILLED_MESSAGE,
        stage: "loro_runtime",
        updateId: verdict.updateId,
      },
    ],
  });
  return attempts;
}

/** Settles each orphan and deletes it; returns the attempts it counted. */
async function claimOrphansInTransaction(
  tx: ClaimTransaction,
  claim: OrphanClaim,
  orphans: readonly LoroWindow[],
  lifetimes: LoroLifetimes,
): Promise<{ attempts: number; updateId: string }[]> {
  const counted: { attempts: number; updateId: string }[] = [];
  let isolation = await readLoroIsolation(tx, claim.scope);
  for (const orphan of orphans) {
    const verdict = judgeOrphanWindow(orphan, {
      documentId: claim.documentId,
      endedHidden: lifetimes.endedHidden(orphan.lifetimeId),
      judge: claim.judge,
    });
    if (verdict.kind === "count") {
      const attempts = await countOrphanAttemptInTransaction(
        tx,
        claim,
        verdict,
      );
      counted.push({ attempts, updateId: verdict.updateId });
    } else if (verdict.kind === "isolate") {
      isolation = transitionLoroIsolation(isolation, {
        type: "orphanIsolated",
        documentId: claim.documentId,
        suspects: verdict.suspects,
      });
    }
    await deleteLoroWindowInTransaction(tx, claim.scope, orphan.lifetimeId);
  }
  await writeLoroIsolationInTransaction(tx, claim.scope, isolation);
  return counted;
}

/**
 * Claims the windows ended lifetimes left on this scope, before the page's
 * recorded judgements are read: a window that held one update records one
 * `loro_runtime` attempt toward it, a final void at the limit; any other
 * window isolates its updates; a window whose lifetime the user ended by
 * hiding the app counts nothing. A live lifetime's window is left alone.
 */
export async function claimDocumentSyncOrphanWindows(
  input: WindowScopeInput & {
    readonly documentId: string;
    readonly isCurrent?: (() => boolean) | undefined;
    readonly logError?: WorkflowRuntimeUtilInput["logError"] | undefined;
  },
): Promise<void> {
  const lifetimes = input.lifetimes ?? processLoroLifetimes;
  await ensureDocumentTables(input.execSql);
  const foreign = await readForeignLoroWindows(
    getClientSQLitePersistenceRuntime(input.execSql).db,
    input.scope,
    lifetimes.id,
  );
  if (foreign.length === 0) return;
  const ended = await lifetimes.endedAmong(
    foreign.map((window) => window.lifetimeId),
  );
  const orphans = foreign.filter((window) => ended.has(window.lifetimeId));
  if (orphans.length === 0) return;
  const claim: OrphanClaim = {
    documentId: input.documentId,
    judge: documentVerdictJudge(),
    scope: input.scope,
  };
  let counted: { attempts: number; updateId: string }[] = [];
  const outcome = await runSerializedSqlMutation(input.execSql, (locked) =>
    getClientSQLitePersistenceRuntime(locked).guardedTransaction(
      async (tx) => {
        counted = await claimOrphansInTransaction(
          tx,
          claim,
          orphans,
          lifetimes,
        );
      },
      input.isCurrent ?? (() => true),
    ),
  );
  if (!outcome.committed) return;
  for (const orphan of orphans) lifetimes.forget(orphan.lifetimeId);
  for (const { attempts, updateId } of counted) {
    reportQuietly(
      input.logError,
      `Documents: the process ended while reading a sync update (attempt ${attempts} of ${MAX_LORO_RUNTIME_ATTEMPTS}${attempts >= MAX_LORO_RUNTIME_ATTEMPTS ? "; voided" : ""})`,
      new Error(`${KILLED_MESSAGE}: ${updateId}`),
    );
  }
}

/**
 * Opens this lifetime's window on the page's unsettled updates: those it
 * will read with Loro, not its known voids or updates still waiting out a
 * retry delay. A page with none opens no window and writes nothing.
 * Returns whether the window counts.
 */
export async function openDocumentSyncLoroWindow(
  input: WindowScopeInput & {
    readonly documentId: string;
    readonly isCurrent?: (() => boolean) | undefined;
    readonly knownVoids: ReadonlyMap<string, unknown>;
    readonly ledger: LoroRuntimeAttempts;
    readonly result: PageResult;
  },
): Promise<boolean> {
  const lifetimes = input.lifetimes ?? processLoroLifetimes;
  const unsettled = input.result.decryptedUpdates
    .map((update) => update.id)
    .filter((id) => !input.knownVoids.has(id) && input.ledger.mayAttempt(id));
  if (unsettled.length === 0) return false;
  await lifetimes.ready();
  const counts = loroWindowCounts(unsettled.length, input.ledger.hasFailed());
  const [only] = unsettled;
  const epoch = counts
    ? optionalHeaderEpoch(
        input.result.response.updates.find((update) => update.id === only),
      )
    : null;
  const scopes = scopesOf(lifetimes);
  const key = scopeKey(input.scope);
  // Counted first, so a death once the row commits leaves a hidden marker.
  if (!scopes.has(key)) {
    scopes.add(key);
    lifetimes.windowOpened();
  }
  await runSerializedSqlMutation(input.execSql, (locked) =>
    getClientSQLitePersistenceRuntime(locked).guardedTransaction(
      (tx) =>
        writeLoroWindowInTransaction(
          tx,
          input.scope,
          {
            contentKeyEpoch: epoch,
            counts,
            documentId: input.documentId,
            judge: documentVerdictJudge(),
            keyFingerprint:
              epoch === null
                ? null
                : (input.result.contentKeyFingerprintsByEpoch.get(epoch) ??
                  null),
            lifetimeId: lifetimes.id,
            updateIds: unsettled,
          },
          new Date().toISOString(),
        ),
      input.isCurrent ?? (() => true),
    ),
  );
  return counts;
}

/**
 * After a Loro runtime failure no update recorded, this lifetime's windows
 * count nothing more. A counted failure does the same in the transaction
 * that records it (`recordDocumentSyncRuntimeFailures`).
 */
export async function stopCountingLoroWindows(
  execSql: ExecSql,
  lifetimes: LoroLifetimes = processLoroLifetimes,
): Promise<void> {
  await runSerializedSqlMutation(execSql, (locked) =>
    getClientSQLitePersistenceRuntime(locked).guardedTransaction(
      (tx) => markLoroWindowsNotCountingInTransaction(tx, lifetimes.id),
      () => true,
    ),
  );
}

/**
 * Closes this lifetime's window in the transaction that saves the page, and
 * clears the suspects the page served; a completed pull clears them all.
 */
export async function closeDocumentSyncLoroWindowInTransaction(
  transactionExecSql: ExecSql,
  input: {
    readonly documentId: string;
    readonly lifetimes?: LoroLifetimes | undefined;
    readonly scope: DocumentScope;
    readonly synced: Pick<SyncRemoteDocumentResult, "response">;
  },
): Promise<void> {
  const lifetimes = input.lifetimes ?? processLoroLifetimes;
  const db = getClientSQLitePersistenceRuntime(transactionExecSql).db;
  if (scopesOf(lifetimes).has(scopeKey(input.scope))) {
    await deleteLoroWindowInTransaction(db, input.scope, lifetimes.id);
  }
  const isolation = await readLoroIsolation(db, input.scope);
  if (isolation.status === "free") return;
  const next: LoroIsolation = transitionLoroIsolation(isolation, {
    type: "pageCommitted",
    documentId: input.documentId,
    pullCompleted: !input.synced.response.pullPage.hasMore,
    servedUpdateIds: input.synced.response.updates.map((update) => update.id),
  });
  await writeLoroIsolationInTransaction(db, input.scope, next);
}

/**
 * Settles this lifetime's window once the page's save is over. A save that
 * committed already deleted the row; any other outcome deletes it here, best
 * effort, so a later death of this lifetime cannot count a page it left.
 */
export async function settleDocumentSyncLoroWindow(
  input: WindowScopeInput & { readonly committed: boolean },
): Promise<void> {
  const lifetimes = input.lifetimes ?? processLoroLifetimes;
  const scopes = scopesOf(lifetimes);
  const key = scopeKey(input.scope);
  if (!scopes.has(key)) return;
  if (!input.committed) {
    try {
      await runSerializedSqlMutation(input.execSql, (locked) =>
        getClientSQLitePersistenceRuntime(locked).guardedTransaction(
          (tx) => deleteLoroWindowInTransaction(tx, input.scope, lifetimes.id),
          () => true,
        ),
      );
    } catch {
      // The row stays until this scope's next page replaces it.
      return;
    }
  }
  scopes.delete(key);
  lifetimes.windowClosed();
}

/** The page limit the scope's next pull asks for while it isolates. */
export async function readDocumentSyncPageLimit(
  execSql: ExecSql,
  input: { readonly documentId: string; readonly scope: DocumentScope },
): Promise<1 | undefined> {
  await ensureDocumentTables(execSql);
  return loroIsolationPageLimit(
    await readLoroIsolation(
      getClientSQLitePersistenceRuntime(execSql).db,
      input.scope,
    ),
    input.documentId,
  );
}

function reportQuietly(
  logError: WorkflowRuntimeUtilInput["logError"] | undefined,
  message: string,
  error: Error,
): void {
  try {
    logError?.(message, error);
  } catch {
    // Reporting never fails a sync pass.
  }
}
