import { documentVerdictJudge } from "../../../data/documents/shared/sync/documentUpdateVerdict";
import {
  type LoroLifetimes,
  processLoroLifetimes,
} from "../../../data/documents/shared/sync/loroLifetime";
import { MAX_LORO_RUNTIME_ATTEMPTS } from "../../../data/documents/shared/sync/loroRuntimeFailureLedger";
import {
  judgeOrphanWindow,
  loroIsolationPageLimit,
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
  readForeignLoroWindows,
  readLifetimesWithWindows,
  readLoroIsolation,
  writeLoroIsolationInTransaction,
} from "../../../data/persistence/documents/records/loroWindowPersistence";
import { getClientSQLitePersistenceRuntime } from "../../../data/sqlite/sqlitePersistenceRuntime";
import {
  type ExecSql,
  runSerializedSqlMutation,
} from "../../../data/sqlite/sqlSchema";
import type { WorkflowRuntimeUtilInput } from "../../shared/runtimeInput";
import { reportQuietly } from "./reportQuietly";

/**
 * Claims the Loro read windows ended lifetimes left (#3194), and the page
 * limit a scope isolating their updates asks for. A pass opens and settles
 * its own window (`loroPassWindow.ts`).
 */

const KILLED_MESSAGE = "The process ended while reading this update";

interface WindowScopeInput {
  readonly execSql: ExecSql;
  /** @internal This realm's lifetime; tests stand in another one. */
  readonly lifetimes?: LoroLifetimes | undefined;
  readonly scope: DocumentScope;
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
