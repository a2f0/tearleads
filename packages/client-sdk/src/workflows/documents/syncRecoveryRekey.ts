import { base64ToBytes } from "@tearleads/encoding";
import type { DocumentSyncResponse } from "@tearleads/validators/response";
import {
  type PendingUpdateRecord,
  rekeyDocumentPendingUpdate,
} from "../../data/sqlite/documentPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";

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
 * Returns the fresh ids so callers can treat re-keying as settlement-like
 * progress and schedule the pass that actually submits them.
 */
export async function rekeyUnsettledRecoveryPendingUpdates(input: {
  execSql: ExecSql;
  recoveryPendingUpdatesById: ReadonlyMap<string, PendingUpdateRecord>;
  settledPendingUpdateIds: readonly string[];
}): Promise<string[]> {
  const settled = new Set(input.settledPendingUpdateIds);
  const rekeyedPendingUpdateIds: string[] = [];
  for (const pendingUpdateId of input.recoveryPendingUpdatesById.keys()) {
    if (!settled.has(pendingUpdateId)) {
      rekeyedPendingUpdateIds.push(
        await rekeyDocumentPendingUpdate(input.execSql, pendingUpdateId),
      );
    }
  }
  return rekeyedPendingUpdateIds;
}
