import type { SyncRemoteDocumentResult } from "../../../data/documents/shared/sync/documentSyncTypes";
import { optionalHeaderEpoch } from "../../../data/documents/shared/sync/documentSyncUpdateIsolation";
import { documentVerdictJudge } from "../../../data/documents/shared/sync/documentUpdateVerdict";
import {
  type LoroLifetimes,
  processLoroLifetimes,
} from "../../../data/documents/shared/sync/loroLifetime";
import type { LoroRuntimeAttempts } from "../../../data/documents/shared/sync/loroRuntimeFailureLedger";
import {
  type LoroIsolation,
  loroIsolationPageLimit,
  loroWindowCounts,
  transitionLoroIsolation,
} from "../../../data/documents/shared/sync/loroWindowMachine";
import type { DocumentScope } from "../../../data/persistence/documents/records";
import {
  deleteOwnLoroWindowInTransaction,
  markLoroWindowsNotCountingInTransaction,
  readLoroIsolation,
  writeLoroIsolationInTransaction,
  writeLoroWindowInTransaction,
} from "../../../data/persistence/documents/records/loroWindowPersistence";
import { getClientSQLitePersistenceRuntime } from "../../../data/sqlite/sqlitePersistenceRuntime";
import {
  type ExecSql,
  runSerializedSqlMutation,
} from "../../../data/sqlite/sqlSchema";

/**
 * A sync pass's Loro read window (#3194). A page's reads of served payloads
 * run inside a window committed once the reader's history is built and
 * deleted by the page's save, so a process that dies inside it leaves the
 * window for its next lifetime to claim (`loroWindows.ts`).
 */

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

/** A window a pass holds open, and the database its row was written to. */
interface HeldLoroWindow {
  readonly execSql: ExecSql;
  readonly id: string;
  readonly lifetimes: LoroLifetimes;
  readonly scope: DocumentScope;
}

/**
 * The read window of one sync pass: the pass's pulls open it, a page's save
 * closes it, and the pass settles it as it ends. It is the pass's own. A
 * second pass reading the same scope at once, as when the store's runtime
 * moved mid-pass, holds another window, and neither closes the other's.
 */
export interface DocumentSyncLoroWindow {
  held: HeldLoroWindow | null;
}

export function createDocumentSyncLoroWindow(): DocumentSyncLoroWindow {
  return { held: null };
}

/** Each lifetime's open windows, by id, with their rows' databases. */
const openWindowDatabases = new WeakMap<LoroLifetimes, Map<string, ExecSql>>();

function windowDatabasesOf(lifetimes: LoroLifetimes): Map<string, ExecSql> {
  const databases =
    openWindowDatabases.get(lifetimes) ?? new Map<string, ExecSql>();
  openWindowDatabases.set(lifetimes, databases);
  return databases;
}

/**
 * What opening a page's window left: no window over its reads, one whose
 * death isolates the page's updates, or one whose death counts toward its
 * single update.
 */
export type LoroWindowOpening = "none" | "isolating" | "counting";

/**
 * The pass's window for this page: the one it holds, when a later page of
 * the pass reads the same database, or a new one once the held window is
 * settled. The new window is noted before its row is written, so a death
 * once the row commits leaves the lifetime's markers.
 */
async function holdLoroWindow(
  window: DocumentSyncLoroWindow,
  target: WindowScopeInput & {
    readonly isolating: boolean;
    readonly lifetimes: LoroLifetimes;
  },
): Promise<HeldLoroWindow> {
  const { held } = window;
  if (
    held?.execSql === target.execSql &&
    held.lifetimes === target.lifetimes &&
    held.scope.appKind === target.scope.appKind &&
    held.scope.localId === target.scope.localId
  ) {
    return held;
  }
  await settleDocumentSyncLoroWindow(window, null);
  const id = await target.lifetimes.openWindow(target.isolating);
  const next = { ...target, id };
  window.held = next;
  windowDatabasesOf(target.lifetimes).set(id, target.execSql);
  return next;
}

/**
 * Stops the lifetime's windows in other databases counting: a death now
 * could be this page's. A database that cannot be written leaves the
 * failure marker standing instead, so those windows isolate.
 */
async function stopCountingElsewhere(held: HeldLoroWindow): Promise<void> {
  const others = new Set(windowDatabasesOf(held.lifetimes).values());
  others.delete(held.execSql);
  for (const database of others) {
    try {
      await stopCountingLoroWindows(database, held.lifetimes);
    } catch {
      held.lifetimes.noteUnsettledWindow();
    }
  }
}

/**
 * Opens the pass's window on the page's unsettled updates: those it will
 * read with Loro, not its known voids or updates still waiting out a retry
 * delay. A page with none opens no window and writes nothing.
 *
 * A death counts only toward the update alone in the lifetime's only open
 * window, so opening this window stops every other window of the lifetime
 * counting, in any database. A page isolating the updates a death left
 * waits to read alone (`loroWindowGate.ts`). Returns whether a window now
 * covers the page's reads, and whether it counts a death.
 */
export async function openDocumentSyncLoroWindow(
  input: WindowScopeInput & {
    readonly documentId: string;
    readonly knownVoids: ReadonlyMap<string, unknown>;
    readonly ledger: LoroRuntimeAttempts;
    readonly result: PageResult;
    readonly window: DocumentSyncLoroWindow;
  },
): Promise<LoroWindowOpening> {
  const lifetimes = input.lifetimes ?? processLoroLifetimes;
  const unsettled = input.result.decryptedUpdates
    .map((update) => update.id)
    .filter((id) => !input.knownVoids.has(id) && input.ledger.mayAttempt(id));
  if (unsettled.length === 0 || !(await lifetimes.ready())) return "none";
  const isolating =
    loroIsolationPageLimit(
      await readLoroIsolation(
        getClientSQLitePersistenceRuntime(input.execSql).db,
        input.scope,
      ),
      input.documentId,
    ) !== undefined;
  const held = await holdLoroWindow(input.window, {
    ...input,
    isolating,
    lifetimes,
  });
  await stopCountingElsewhere(held);
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
            windowId: held.id,
          },
          new Date().toISOString(),
        );
      },
      // The page is read whatever the pass's generation: its window too.
      () => true,
    ),
  );
  return counts ? "counting" : "isolating";
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
 * Closes the pass's window in the transaction that saves the page, and
 * clears the suspects the page passed (accepted or voided, not held or
 * deferred); a completed pull clears them all. A save with no window, such
 * as rotation's, still clears the suspects it passed.
 */
export async function closeDocumentSyncLoroWindowInTransaction(
  transactionExecSql: ExecSql,
  input: {
    readonly documentId: string;
    readonly scope: DocumentScope;
    readonly synced: Pick<
      SyncRemoteDocumentResult,
      | "decryptedUpdates"
      | "hasHeldPull"
      | "hasIncompletePull"
      | "response"
      | "voidedUpdates"
    >;
    readonly window: DocumentSyncLoroWindow | null;
  },
): Promise<void> {
  const { synced } = input;
  const db = getClientSQLitePersistenceRuntime(transactionExecSql).db;
  const held = input.window?.held;
  if (held) {
    await deleteOwnLoroWindowInTransaction(db, held.scope, {
      lifetimeId: held.lifetimes.id,
      windowId: held.id,
    });
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
 * Settles the pass's window once a page's save is over, or as the pass
 * ends. `committedTo` is the database a save of the page committed to,
 * which already deleted the row there; otherwise the row is deleted here,
 * from the database the window was opened in, so a later death of this
 * lifetime cannot count a page it left. A row that cannot be deleted
 * leaves the lifetime's failure marker standing, so its death isolates
 * that row's updates instead of counting them.
 */
export async function settleDocumentSyncLoroWindow(
  window: DocumentSyncLoroWindow,
  committedTo: ExecSql | null,
): Promise<void> {
  const { held } = window;
  if (!held) return;
  window.held = null;
  if (held.execSql !== committedTo) {
    try {
      await runSerializedSqlMutation(held.execSql, (locked) =>
        getClientSQLitePersistenceRuntime(locked).guardedTransaction(
          (tx) =>
            deleteOwnLoroWindowInTransaction(tx, held.scope, {
              lifetimeId: held.lifetimes.id,
              windowId: held.id,
            }),
          () => true,
        ),
      );
    } catch {
      held.lifetimes.noteUnsettledWindow();
    }
  }
  windowDatabasesOf(held.lifetimes).delete(held.id);
  held.lifetimes.closeWindow(held.id);
}
