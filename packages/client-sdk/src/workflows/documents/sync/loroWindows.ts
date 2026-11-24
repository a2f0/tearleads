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
import { reportQuietly } from "./reportQuietly";

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

/**
 * The database each open window's row was written to, so its settle deletes
 * it there even after the store's runtime moved to another database.
 */
const windowDatabases = new WeakMap<LoroLifetimes, Map<string, ExecSql>>();

function rememberWindowDatabase(
  lifetimes: LoroLifetimes,
  key: string,
  execSql: ExecSql,
): void {
  const databases =
    windowDatabases.get(lifetimes) ?? new Map<string, ExecSql>();
  databases.set(key, execSql);
  windowDatabases.set(lifetimes, databases);
}

function takeWindowDatabase(
  lifetimes: LoroLifetimes,
  key: string,
): ExecSql | undefined {
  const databases = windowDatabases.get(lifetimes);
  const database = databases?.get(key);
  databases?.delete(key);
  return database;
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

/**
 * Records one more `loro_runtime` attempt toward the update a death held,
 * and returns the attempts; null when the update is already settled under
 * the same key (another tab voided it since, at any stage), which stands.
 */
async function countOrphanAttemptInTransaction(
  tx: ClaimTransaction,
  claim: OrphanClaim,
  verdict: Extract<OrphanVerdict, { kind: "count" }>,
): Promise<number | null> {
  const [recorded] = await readRecordedImportVoids(tx, {
    judge: claim.judge,
    scope: claim.scope,
    updateIds: [verdict.updateId],
  });
  const sameKey =
    recorded !== undefined &&
    recorded.keyFingerprint === verdict.keyFingerprint;
  const priorAttempts =
    sameKey && recorded.stage === "loro_runtime" ? (recorded.attempts ?? 0) : 0;
  if (
    sameKey &&
    (recorded.stage !== "loro_runtime" ||
      priorAttempts >= MAX_LORO_RUNTIME_ATTEMPTS)
  ) {
    return null;
  }
  const attempts = priorAttempts + 1;
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
 * deletes them. Each is settled only by the claim whose delete removed it:
 * the database worker does not isolate one tab's transaction from another
 * tab's statements, so two tabs may read the same orphan, and a window is
 * counted at most once.
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
  const claimed: string[] = [];
  for (const orphan of orphans) {
    if (
      !(await deleteLoroWindowInTransaction(tx, claim.scope, orphan.lifetimeId))
    ) {
      continue;
    }
    claimed.push(orphan.lifetimeId);
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
      if (attempts !== null) {
        counted.push({ attempts, updateId: verdict.updateId });
      }
    } else if (verdict.kind === "isolate") {
      isolation = transitionLoroIsolation(isolation, {
        type: "orphanIsolated",
        documentId: claim.documentId,
        suspects: verdict.suspects,
      });
    }
  }
  await writeLoroIsolationInTransaction(tx, claim.scope, isolation);
  // A lifetime's markers stay until its windows on other scopes are claimed.
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
 * window, so the transaction that writes this window stops every other
 * window of the lifetime counting. A scope isolating
 * the updates a death left waits to read alone (`loroWindowGate.ts`).
 * Returns whether the window counts.
 */
export async function openDocumentSyncLoroWindow(
  input: WindowScopeInput & {
    readonly documentId: string;
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
  rememberWindowDatabase(lifetimes, scopeKey(input.scope), input.execSql);
  const [only] = unsettled;
  const epoch = optionalHeaderEpoch(
    input.result.response.updates.find((update) => update.id === only),
  );
  // Without markers a close would read as a death: such a window isolates.
  const keepsMarkers = lifetimes.keepsMarkers();
  let counts = false;
  await runSerializedSqlMutation(input.execSql, (locked) =>
    getClientSQLitePersistenceRuntime(locked).guardedTransaction(
      async (tx) => {
        counts =
          keepsMarkers &&
          lifetimes.openWindowCount() === 1 &&
          loroWindowCounts(unsettled.length, input.ledger.hasFailed());
        // Beside another window none counts, nor does a row a failed settle
        // left; this window's own row is replaced below.
        await markLoroWindowsNotCountingInTransaction(tx, lifetimes.id);
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
      // The page is read whatever the pass's generation: its window too.
      () => true,
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
 * clears the suspects the page passed (accepted or voided, not held or
 * deferred); a completed pull clears them all.
 */
export async function closeDocumentSyncLoroWindowInTransaction(
  transactionExecSql: ExecSql,
  input: {
    readonly documentId: string;
    readonly lifetimes?: LoroLifetimes | undefined;
    readonly scope: DocumentScope;
    readonly synced: Pick<
      SyncRemoteDocumentResult,
      | "decryptedUpdates"
      | "hasHeldPull"
      | "hasIncompletePull"
      | "response"
      | "voidedUpdates"
    >;
  },
): Promise<void> {
  const { synced } = input;
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
    // A held or deferred page is handed on as if complete; it is not.
    pullCompleted:
      !synced.response.pullPage.hasMore &&
      !synced.hasHeldPull &&
      !synced.hasIncompletePull,
    passedUpdateIds: [
      ...synced.decryptedUpdates.map((update) => update.id),
      ...synced.voidedUpdates.map((voided) => voided.updateId),
    ],
  });
  await writeLoroIsolationInTransaction(db, input.scope, next);
}

/**
 * Settles this lifetime's window once the page's save is over. A save that
 * committed to the window's database already deleted the row; any other
 * outcome deletes it here, from the database the window was opened in, so a
 * later death of this lifetime cannot count a page it left. A row that
 * cannot be deleted leaves the lifetime's failure marker standing, so its
 * death isolates that row's updates instead of counting them.
 */
export async function settleDocumentSyncLoroWindow(
  input: WindowScopeInput & { readonly committed: boolean },
): Promise<void> {
  const lifetimes = input.lifetimes ?? processLoroLifetimes;
  const key = scopeKey(input.scope);
  if (!lifetimes.hasWindow(key)) return;
  const database = takeWindowDatabase(lifetimes, key) ?? input.execSql;
  if (!input.committed || database !== input.execSql) {
    try {
      await runSerializedSqlMutation(database, (locked) =>
        getClientSQLitePersistenceRuntime(locked).guardedTransaction(
          (tx) => deleteLoroWindowInTransaction(tx, input.scope, lifetimes.id),
          () => true,
        ),
      );
    } catch {
      lifetimes.noteUnsettledWindow();
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
