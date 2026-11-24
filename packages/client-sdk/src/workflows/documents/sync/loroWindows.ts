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
  readLifetimesWithWindows,
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

function scopeKey(scope: DocumentScope): string {
  return `${scope.appKind}\u0000${scope.localId}`;
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

interface ClaimedOrphans {
  readonly counted: readonly { attempts: number; updateId: string }[];
  /** Claimed lifetimes with no window left on any scope. */
  readonly settled: readonly string[];
}

/**
 * Settles the orphans of ended lifetimes `ended` still on the scope, and
 * deletes them. Read inside the transaction: another tab may have claimed
 * one since this tab listed them, and a window is counted at most once.
 */
async function claimOrphansInTransaction(
  tx: ClaimTransaction,
  claim: OrphanClaim,
  ended: ReadonlySet<string>,
  lifetimes: LoroLifetimes,
): Promise<ClaimedOrphans> {
  const orphans = (
    await readForeignLoroWindows(tx, claim.scope, lifetimes.id)
  ).filter((window) => ended.has(window.lifetimeId));
  const counted: { attempts: number; updateId: string }[] = [];
  let isolation = await readLoroIsolation(tx, claim.scope);
  for (const orphan of orphans) {
    const verdict = judgeOrphanWindow(orphan, {
      documentId: claim.documentId,
      endedFailed: lifetimes.endedFailed(orphan.lifetimeId),
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
  // A lifetime's markers stay until its windows on other scopes are claimed.
  const claimed = orphans.map((orphan) => orphan.lifetimeId);
  const remaining = await readLifetimesWithWindows(tx, claimed);
  return { counted, settled: claimed.filter((id) => !remaining.has(id)) };
}

/**
 * Claims the windows ended lifetimes left on this scope, before the page's
 * recorded judgements are read: a window that held one update records one
 * `loro_runtime` attempt toward it, a final void at the limit; any other
 * window isolates its updates, as does one whose lifetime had met a runtime
 * failure; a window whose lifetime the user ended by hiding the app counts
 * nothing. A live lifetime's window is left alone.
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
  if (ended.size === 0) return;
  const claim: OrphanClaim = {
    documentId: input.documentId,
    judge: documentVerdictJudge(),
    scope: input.scope,
  };
  let claimed: ClaimedOrphans = { counted: [], settled: [] };
  const outcome = await runSerializedSqlMutation(input.execSql, (locked) =>
    getClientSQLitePersistenceRuntime(locked).guardedTransaction(
      async (tx) => {
        claimed = await claimOrphansInTransaction(tx, claim, ended, lifetimes);
      },
      input.isCurrent ?? (() => true),
    ),
  );
  if (!outcome.committed) return;
  for (const lifetimeId of claimed.settled) lifetimes.forget(lifetimeId);
  // An invalidated generation reports nothing, as its verdicts do not.
  if (input.isCurrent?.() === false) return;
  for (const { attempts, updateId } of claimed.counted) {
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
 *
 * A death counts only toward the update alone in the lifetime's only open
 * window, so the transaction that writes this window stops every window of
 * the lifetime counting when another is open beside it. A scope isolating
 * the updates a death left waits to read alone (`loroWindowGate.ts`).
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
  if (unsettled.length === 0 || !(await lifetimes.ready())) return false;
  const isolating =
    loroIsolationPageLimit(
      await readLoroIsolation(
        getClientSQLitePersistenceRuntime(input.execSql).db,
        input.scope,
      ),
      input.documentId,
    ) !== undefined;
  // Noted first, so a death once the row commits leaves its markers.
  await lifetimes.openWindow(scopeKey(input.scope), isolating);
  const [only] = unsettled;
  const epoch = optionalHeaderEpoch(
    input.result.response.updates.find((update) => update.id === only),
  );
  let counts = false;
  await runSerializedSqlMutation(input.execSql, (locked) =>
    getClientSQLitePersistenceRuntime(locked).guardedTransaction(
      async (tx) => {
        const alone = lifetimes.openWindowCount() === 1;
        counts =
          alone && loroWindowCounts(unsettled.length, input.ledger.hasFailed());
        if (!alone) {
          await markLoroWindowsNotCountingInTransaction(tx, lifetimes.id);
        }
        await writeLoroWindowInTransaction(
          tx,
          input.scope,
          {
            contentKeyEpoch: counts ? epoch : null,
            counts,
            documentId: input.documentId,
            judge: documentVerdictJudge(),
            keyFingerprint:
              counts && epoch !== null
                ? (input.result.contentKeyFingerprintsByEpoch.get(epoch) ??
                  null)
                : null,
            lifetimeId: lifetimes.id,
            updateIds: unsettled,
          },
          new Date().toISOString(),
        );
      },
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
  if (lifetimes.hasWindow(scopeKey(input.scope))) {
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
  const key = scopeKey(input.scope);
  if (!lifetimes.hasWindow(key)) return;
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
  lifetimes.closeWindow(key);
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
