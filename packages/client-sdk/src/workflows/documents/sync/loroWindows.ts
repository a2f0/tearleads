import { documentVerdictJudge } from "../../../data/documents/shared/sync/documentUpdateVerdict";
import {
  type LoroLifetimes,
  processLoroLifetimes,
} from "../../../data/documents/shared/sync/loroLifetime";
import { MAX_LORO_RUNTIME_ATTEMPTS } from "../../../data/documents/shared/sync/loroRuntimeFailureLedger";
import {
  judgeOrphanWindow,
  type LoroIsolation,
  loroIsolationPageLimit,
  type OrphanVerdict,
  transitionLoroIsolation,
} from "../../../data/documents/shared/sync/loroWindowMachine";
import {
  currentRotationAvailability,
  MAX_ROTATION_DEATHS,
  type RotationAvailability,
  transitionRotationAvailability,
} from "../../../data/documents/shared/sync/rotationAvailabilityMachine";
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
import {
  readRotationAvailability,
  writeRotationAvailabilityInTransaction,
} from "../../../data/persistence/documents/records/rotationAvailabilityPersistence";
import {
  type ClientSQLiteTransactionScope,
  getClientSQLitePersistenceRuntime,
} from "../../../data/sqlite/sqlitePersistenceRuntime";
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
const ROTATION_KILLED_MESSAGE =
  "The process ended rebuilding history for a key rotation";

interface WindowScopeInput {
  readonly execSql: ExecSql;
  /** @internal This realm's lifetime; tests stand in another one. */
  readonly lifetimes?: LoroLifetimes | undefined;
  readonly scope: DocumentScope;
}

interface OrphanClaim {
  readonly documentId: string;
  readonly judge: string;
  readonly scope: DocumentScope;
}

/**
 * Records one more `loro_runtime` attempt toward the update a death held,
 * and returns the attempts; null when the update is already settled
 * (another tab voided it since, at any stage), which stands.
 */
async function countOrphanAttemptInTransaction(
  tx: ClientSQLiteTransactionScope,
  claim: OrphanClaim,
  verdict: Extract<OrphanVerdict, { kind: "count" }>,
): Promise<number | null> {
  const [recorded] = await readRecordedImportVoids(tx, {
    judge: claim.judge,
    scope: claim.scope,
    updateIds: [verdict.updateId],
  });
  const priorAttempts =
    recorded?.stage === "loro_runtime" ? (recorded.attempts ?? 0) : 0;
  if (
    recorded !== undefined &&
    (recorded.stage !== "loro_runtime" ||
      priorAttempts >= MAX_LORO_RUNTIME_ATTEMPTS)
  ) {
    return null;
  }
  const attempts = priorAttempts + 1;
  await recordDocumentSyncVerdictsInTransaction(tx, {
    acceptedUpdateIds: [],
    documentId: claim.documentId,
    judge: claim.judge,
    now: new Date().toISOString(),
    scope: claim.scope,
    voids: [
      {
        attempts,
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
  /** The scope's rotation availability after a counted rotation death. */
  readonly rotation: RotationAvailability | null;
  /** Claimed lifetimes with no window left on any scope. */
  readonly settled: readonly string[];
}

/** What one claim has decided so far, as its orphans are judged. */
interface ClaimTally {
  readonly counted: { attempts: number; updateId: string }[];
  readonly countedUpdates: Set<string>;
  isolation: LoroIsolation;
  rotation: RotationAvailability | null;
}

/**
 * Applies one claimed orphan's verdict. A claim counts at most one rotation
 * death, as it counts at most one attempt per update.
 */
async function applyOrphanVerdict(
  tx: ClientSQLiteTransactionScope,
  claim: OrphanClaim,
  verdict: OrphanVerdict,
  tally: ClaimTally,
): Promise<void> {
  if (verdict.kind === "count") {
    if (tally.countedUpdates.has(verdict.updateId)) return;
    tally.countedUpdates.add(verdict.updateId);
    const attempts = await countOrphanAttemptInTransaction(tx, claim, verdict);
    if (attempts !== null) {
      tally.counted.push({ attempts, updateId: verdict.updateId });
    }
    return;
  }
  if (verdict.kind === "discard") return;
  if (verdict.kind === "rotationDeath" && tally.rotation === null) {
    const before = currentRotationAvailability(
      await readRotationAvailability(tx, claim.scope),
      claim,
    );
    // An unavailable rotation counts and reports no more deaths.
    if (before.status !== "unavailable") {
      tally.rotation = transitionRotationAvailability(before, {
        ...claim,
        type: "rotationDied",
      });
    }
  }
  tally.isolation = transitionLoroIsolation(tally.isolation, {
    type: "orphanIsolated",
    documentId: claim.documentId,
    suspects: verdict.suspects,
  });
}

/**
 * Settles the orphans of ended lifetimes `ended` still on the scope, and
 * deletes them. Each is settled only by the claim whose delete removed it:
 * the database worker does not isolate one tab's transaction from another
 * tab's statements, so two tabs may read the same orphan, and a window is
 * counted at most once. A claim counts at most one attempt per update: tabs
 * reading one update in a browser process that crashes die together.
 */
async function claimOrphansInTransaction(
  tx: ClientSQLiteTransactionScope,
  claim: OrphanClaim,
  ended: ReadonlySet<string>,
  lifetimes: LoroLifetimes,
): Promise<ClaimedOrphans> {
  const orphans = (
    await readForeignLoroWindows(tx, claim.scope, lifetimes.id)
  ).filter((window) => ended.has(window.lifetimeId));
  const tally: ClaimTally = {
    counted: [],
    countedUpdates: new Set(),
    isolation: await readLoroIsolation(tx, claim.scope),
    rotation: null,
  };
  // Read before any delete: another tab's claim may forget a lifetime's
  // markers once its rows are gone.
  const marked = new Map(
    orphans.map((orphan) => [
      orphan.lifetimeId,
      {
        endedFailed: lifetimes.endedFailed(orphan.lifetimeId),
        endedHidden: lifetimes.endedHidden(orphan.lifetimeId),
      },
    ]),
  );
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
      endedFailed: marked.get(orphan.lifetimeId)?.endedFailed ?? false,
      endedHidden: marked.get(orphan.lifetimeId)?.endedHidden ?? false,
      judge: claim.judge,
    });
    await applyOrphanVerdict(tx, claim, verdict, tally);
  }
  await writeLoroIsolationInTransaction(tx, claim.scope, tally.isolation);
  if (tally.rotation !== null) {
    await writeRotationAvailabilityInTransaction(
      tx,
      claim.scope,
      tally.rotation,
      new Date().toISOString(),
    );
  }
  // A lifetime's markers stay until its windows on other scopes are claimed.
  const remaining = await readLifetimesWithWindows(tx, claimed);
  return {
    counted: tally.counted,
    rotation: tally.rotation,
    settled: claimed.filter((id) => !remaining.has(id)),
  };
}

/**
 * Claims the windows ended lifetimes left on this scope, before the page's
 * recorded judgements are read: a read window that held one update records
 * one `loro_runtime` attempt toward it, a final void at the limit; a
 * rotation window records one death toward the scope's rotation
 * (`rotationAvailabilityMachine.ts`) and isolates its updates; any other
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
  let claimed: ClaimedOrphans = { counted: [], rotation: null, settled: [] };
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
  if (claimed.rotation !== null) reportRotationDeath(input, claimed.rotation);
}

/** Reports a counted rotation death, and the rotation it made unavailable. */
function reportRotationDeath(
  input: {
    readonly logError?: WorkflowRuntimeUtilInput["logError"] | undefined;
  },
  rotation: RotationAvailability,
): void {
  if (rotation.status === "available") return;
  reportQuietly(
    input.logError,
    rotation.status === "unavailable"
      ? `Documents: the process ended rebuilding history for a key rotation (death ${rotation.deaths} of ${MAX_ROTATION_DEATHS}); this device starts no more rotations of the document and leaves them to other members`
      : `Documents: the process ended rebuilding history for a key rotation (death ${rotation.deaths} of ${MAX_ROTATION_DEATHS})`,
    new Error(`${ROTATION_KILLED_MESSAGE}: ${rotation.documentId}`),
  );
}

/**
 * The page limit a pull asks for, once the windows ended lifetimes left on
 * its scope are claimed: a pull after a death that named no update then
 * isolates at once, instead of reading the whole page and dying again.
 */
export async function claimThenReadDocumentSyncPageLimit(
  input: Parameters<typeof claimDocumentSyncOrphanWindows>[0],
): Promise<1 | undefined> {
  await claimDocumentSyncOrphanWindows(input);
  return readDocumentSyncPageLimit(input.execSql, input);
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
