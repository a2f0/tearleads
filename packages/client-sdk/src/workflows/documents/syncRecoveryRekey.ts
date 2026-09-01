import { base64ToBytes } from "@symcrypt/encoding";
import type { DocumentSyncResponse } from "@symcrypt/validators/response";
import type { DocumentSyncSubmitFailure } from "../../data/documents/shared/types";
import {
  MAX_PENDING_UPDATE_REKEYS,
  type PendingUpdateRecord,
  rekeyDocumentPendingUpdate,
} from "../../data/sqlite/documentPersistence";
import {
  type ExecSql,
  runSerializedSqlMutation,
} from "../../data/sqlite/sqlSchema";

export type RekeyPendingUpdate = (
  execSql: ExecSql,
  id: string,
) => Promise<string | null>;

interface DecryptedSyncUpdate {
  id: string;
  partialEndVersionVector: string;
  partialStartVersionVector: string;
  updateData: Uint8Array;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength &&
    left.every((value, index) => value === right[index])
  );
}

function pendingUpdateMatchesDecryptedUpdate(
  pendingUpdate: PendingUpdateRecord,
  decryptedUpdate: Omit<DecryptedSyncUpdate, "id">,
): boolean {
  if (
    pendingUpdate.partialStartVersionVector !==
      decryptedUpdate.partialStartVersionVector ||
    pendingUpdate.partialEndVersionVector !==
      decryptedUpdate.partialEndVersionVector
  ) {
    return false;
  }

  return bytesEqual(
    base64ToBytes(pendingUpdate.updateData),
    decryptedUpdate.updateData,
  );
}

export function settledPendingUpdateIdsFromSync(input: {
  decryptedUpdates: readonly DecryptedSyncUpdate[];
  recoveryPendingUpdatesById: ReadonlyMap<string, PendingUpdateRecord>;
  response: DocumentSyncResponse;
}): string[] {
  const settled = new Set(input.response.acceptedOutgoingUpdateIds);

  for (const update of input.decryptedUpdates) {
    const pendingUpdate = input.recoveryPendingUpdatesById.get(update.id);
    if (
      pendingUpdate &&
      pendingUpdateMatchesDecryptedUpdate(pendingUpdate, update)
    ) {
      settled.add(update.id);
    }
  }

  return [...settled];
}

/**
 * A read-only recovery sync settles a conflicted pending update only when the
 * response carries it — but the server's frontier filter omits spans the
 * request's localVersionVector already covers, which a locally-applied
 * pending update always is. Left alone, the conflicted id is resubmitted (and
 * 409s the whole outgoing batch) forever: a lost ack leaves the server
 * holding the original ciphertext, and every rebuild encrypts with a fresh
 * IV, so a byte-identical retry can never be reproduced. Re-key what
 * recovery could not settle so the next sync pass submits the same ops under
 * a conflict-free id; the server-side copy stays harmless because CRDT
 * update import is idempotent.
 *
 * Re-keying goes through the caller's persistence implementation when given
 * (defaulting to the built-in pending-update table) and reports only ids
 * whose row actually changed, so a record living in some other queue never
 * counts as progress. Returns the fresh ids so callers can treat re-keying
 * as settlement-like progress and schedule the pass that submits them.
 *
 * A row whose persisted rekeyCount has reached the bound is not re-keyed
 * again: it is reported as exhausted so the caller can surface a terminal
 * failure instead of feeding an unbounded conflict loop that survives
 * restarts (each session's in-memory lane cap resets, this bound does not).
 */
export async function rekeyUnsettledRecoveryPendingUpdates(input: {
  execSql: ExecSql;
  recoveryPendingUpdatesById: ReadonlyMap<string, PendingUpdateRecord>;
  rekeyPendingUpdate?: RekeyPendingUpdate | undefined;
  settledPendingUpdateIds: readonly string[];
  stillCurrent?: (() => boolean) | undefined;
}): Promise<{
  exhaustedPendingUpdateIds: string[];
  rekeyedPendingUpdateIds: string[];
}> {
  const rekeyPendingUpdate =
    input.rekeyPendingUpdate ?? rekeyDocumentPendingUpdate;
  const settled = new Set(input.settledPendingUpdateIds);
  const rekeyedPendingUpdateIds: string[] = [];
  const exhaustedPendingUpdateIds: string[] = [];
  for (const [pendingUpdateId, record] of input.recoveryPendingUpdatesById) {
    if (settled.has(pendingUpdateId)) {
      continue;
    }
    // Known multi-tab limitation: the count is the row as loaded at pass
    // start, so a sibling tab that settle-deleted the row can make this
    // record a failure for work that no longer exists. The stale failure is
    // transient — the document's next clean pass clears it.
    if ((record.rekeyCount ?? 0) >= MAX_PENDING_UPDATE_REKEYS) {
      exhaustedPendingUpdateIds.push(pendingUpdateId);
      continue;
    }
    const nextId = await runSerializedSqlMutation(
      input.execSql,
      (lockedExecSql) =>
        input.stillCurrent?.() === false
          ? null
          : rekeyPendingUpdate(lockedExecSql, pendingUpdateId),
    );
    if (input.stillCurrent?.() === false) break;
    if (nextId !== null) {
      rekeyedPendingUpdateIds.push(nextId);
    }
  }
  return { exhaustedPendingUpdateIds, rekeyedPendingUpdateIds };
}

/**
 * Re-key what recovery could not settle and surface exhausted rows through
 * the caller's terminal-failure handler. The exhausted count is also
 * returned so the sync result can carry it: a pass that recorded this
 * failure must not read as clean to callers that clear recorded failures
 * on success.
 */
export async function rekeyAndReportUnsettledRecoveryPendingUpdates(
  input: Parameters<typeof rekeyUnsettledRecoveryPendingUpdates>[0] & {
    onTerminalSubmitFailure?:
      | ((failure: DocumentSyncSubmitFailure) => Promise<void> | void)
      | undefined;
  },
): Promise<{
  exhaustedPendingUpdateCount: number;
  rekeyedPendingUpdateIds: string[];
}> {
  const { exhaustedPendingUpdateIds, rekeyedPendingUpdateIds } =
    await rekeyUnsettledRecoveryPendingUpdates(input);
  if (exhaustedPendingUpdateIds.length > 0) {
    await input.onTerminalSubmitFailure?.(
      rekeyLimitSubmitFailure(exhaustedPendingUpdateIds.length),
    );
  }
  return {
    exhaustedPendingUpdateCount: exhaustedPendingUpdateIds.length,
    rekeyedPendingUpdateIds,
  };
}

/**
 * Terminal failure recorded when conflict recovery gives up on pending
 * updates whose persisted re-key bound is exhausted. Shaped like a submit
 * failure so the existing write-queue surface (recordDocumentSyncFailure via
 * onTerminalSubmitFailure) explains the stuck write without new plumbing.
 */
export function rekeyLimitSubmitFailure(
  exhaustedCount: number,
): DocumentSyncSubmitFailure {
  return {
    message: `Update conflict recovery gave up after ${MAX_PENDING_UPDATE_REKEYS} re-key attempts (${exhaustedCount} update${exhaustedCount === 1 ? "" : "s"})`,
    ok: false,
    report: () => {},
    status: null,
  };
}
