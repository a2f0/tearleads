import { and, eq, inArray } from "drizzle-orm";
import { documentPeerPreemptions } from "../../../sqlite/schema/documentSyncVerdictSchema";
import { sqliteRowsPerStatement } from "../../../sqlite/sqliteBindBudget";
import type { ClientSQLiteTransactionScope } from "../../../sqlite/sqlitePersistenceRuntime";
import type { DocumentScope } from "./documentPersistenceTypes";

/** A voided update that reused this device's own operation ids. */
export interface DocumentPeerPreemption {
  readonly authorFingerprint: string | null;
  readonly peerId: string;
  readonly updateId: string;
  readonly writerUserId: string | null;
}

// Two binds name the scope; the rest carry update ids.
const UPDATE_IDS_PER_STATEMENT = sqliteRowsPerStatement(1, 2);

function chunks<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let offset = 0; offset < values.length; offset += size) {
    result.push(values.slice(offset, offset + size));
  }
  return result;
}

function preemptionScope(scope: DocumentScope) {
  return and(
    eq(documentPeerPreemptions.appKind, scope.appKind),
    eq(documentPeerPreemptions.localId, scope.localId),
  );
}

/**
 * Writes a notice for each preemption the scope has not recorded yet and
 * returns their update ids, each to be reported once.
 */
export async function recordDocumentPeerPreemptions(
  tx: ClientSQLiteTransactionScope,
  input: {
    readonly documentId: string;
    readonly now: string;
    readonly preemptions: readonly DocumentPeerPreemption[];
    readonly scope: DocumentScope;
  },
): Promise<string[]> {
  const updateIds = input.preemptions.map((entry) => entry.updateId);
  const existing = new Set<string>();
  for (const batch of chunks(updateIds, UPDATE_IDS_PER_STATEMENT)) {
    const rows = await tx
      .select({ updateId: documentPeerPreemptions.updateId })
      .from(documentPeerPreemptions)
      .where(
        and(
          preemptionScope(input.scope),
          inArray(documentPeerPreemptions.updateId, batch),
        ),
      );
    for (const row of rows) existing.add(row.updateId);
  }
  const fresh = input.preemptions.filter(
    (entry) => !existing.has(entry.updateId),
  );
  for (const entry of fresh) {
    await tx
      .insert(documentPeerPreemptions)
      .values({
        ...entry,
        appKind: input.scope.appKind,
        documentId: input.documentId,
        localId: input.scope.localId,
        noticedAt: input.now,
      })
      .onConflictDoNothing()
      .run();
  }
  return fresh.map((entry) => entry.updateId);
}

/** Removes a deleted or rebound scope's preemption notices. */
export async function deleteDocumentPeerPreemptionsInTransaction(
  tx: Pick<ClientSQLiteTransactionScope, "delete">,
  appKind: string,
  localIds: readonly string[],
): Promise<void> {
  for (const batch of chunks(localIds, UPDATE_IDS_PER_STATEMENT)) {
    await tx
      .delete(documentPeerPreemptions)
      .where(
        and(
          eq(documentPeerPreemptions.appKind, appKind),
          inArray(documentPeerPreemptions.localId, batch),
        ),
      )
      .run();
  }
}
