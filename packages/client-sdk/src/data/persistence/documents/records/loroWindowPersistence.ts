import { and, eq, inArray, ne } from "drizzle-orm";
import {
  LORO_ISOLATION_FREE,
  type LoroIsolation,
  type LoroWindow,
} from "../../../documents/shared/sync/loroWindowMachine";
import {
  documentLoroIsolation,
  documentLoroWindows,
} from "../../../sqlite/schema/documentLoroWindowSchema";
import { sqliteRowsPerStatement } from "../../../sqlite/sqliteBindBudget";
import type { ClientSQLiteTransactionScope } from "../../../sqlite/sqlitePersistenceRuntime";
import type { DocumentScope } from "./documentPersistenceTypes";

// One bind names the app kind; the rest carry local ids.
const LOCAL_IDS_PER_STATEMENT = sqliteRowsPerStatement(1, 1);

function windowScope(scope: DocumentScope) {
  return and(
    eq(documentLoroWindows.appKind, scope.appKind),
    eq(documentLoroWindows.localId, scope.localId),
  );
}

function isolationScope(scope: DocumentScope) {
  return and(
    eq(documentLoroIsolation.appKind, scope.appKind),
    eq(documentLoroIsolation.localId, scope.localId),
  );
}

function stringArray(json: string): readonly string[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

/** The windows other lifetimes hold open on this scope. */
export async function readForeignLoroWindows(
  db: Pick<ClientSQLiteTransactionScope, "select">,
  scope: DocumentScope,
  lifetimeId: string,
): Promise<LoroWindow[]> {
  const rows = await db
    .select()
    .from(documentLoroWindows)
    .where(
      and(windowScope(scope), ne(documentLoroWindows.lifetimeId, lifetimeId)),
    )
    .all();
  return rows.map((row) => ({
    contentKeyEpoch: row.contentKeyEpoch,
    counts: row.counts === 1,
    documentId: row.documentId,
    judge: row.judge,
    keyFingerprint: row.keyFingerprint,
    lifetimeId: row.lifetimeId,
    updateIds: stringArray(row.updateIds),
  }));
}

/** Opens (or replaces) this lifetime's window on the scope. */
export async function writeLoroWindowInTransaction(
  tx: Pick<ClientSQLiteTransactionScope, "insert">,
  scope: DocumentScope,
  window: LoroWindow,
  openedAt: string,
): Promise<void> {
  const values = {
    contentKeyEpoch: window.contentKeyEpoch,
    counts: window.counts ? 1 : 0,
    documentId: window.documentId,
    judge: window.judge,
    keyFingerprint: window.keyFingerprint,
    openedAt,
    updateIds: JSON.stringify(window.updateIds),
  };
  await tx
    .insert(documentLoroWindows)
    .values({
      ...values,
      appKind: scope.appKind,
      lifetimeId: window.lifetimeId,
      localId: scope.localId,
    })
    .onConflictDoUpdate({
      set: values,
      target: [
        documentLoroWindows.appKind,
        documentLoroWindows.localId,
        documentLoroWindows.lifetimeId,
      ],
    })
    .run();
}

/** Deletes a lifetime's window on the scope, its own or a claimed orphan's. */
export async function deleteLoroWindowInTransaction(
  tx: Pick<ClientSQLiteTransactionScope, "delete">,
  scope: DocumentScope,
  lifetimeId: string,
): Promise<void> {
  await tx
    .delete(documentLoroWindows)
    .where(
      and(windowScope(scope), eq(documentLoroWindows.lifetimeId, lifetimeId)),
    )
    .run();
}

/**
 * After a Loro runtime failure this lifetime counted, its open windows count
 * nothing more: a later death in the same lifetime isolates instead.
 */
export async function markLoroWindowsNotCountingInTransaction(
  tx: Pick<ClientSQLiteTransactionScope, "update">,
  lifetimeId: string,
): Promise<void> {
  await tx
    .update(documentLoroWindows)
    .set({ contentKeyEpoch: null, counts: 0, keyFingerprint: null })
    .where(eq(documentLoroWindows.lifetimeId, lifetimeId))
    .run();
}

export async function readLoroIsolation(
  db: Pick<ClientSQLiteTransactionScope, "select">,
  scope: DocumentScope,
): Promise<LoroIsolation> {
  const [row] = await db
    .select()
    .from(documentLoroIsolation)
    .where(isolationScope(scope))
    .limit(1)
    .all();
  const suspects = row ? stringArray(row.suspects) : [];
  return row && suspects.length > 0
    ? { status: "isolating", documentId: row.documentId, suspects }
    : LORO_ISOLATION_FREE;
}

export async function writeLoroIsolationInTransaction(
  tx: Pick<ClientSQLiteTransactionScope, "delete" | "insert">,
  scope: DocumentScope,
  state: LoroIsolation,
): Promise<void> {
  if (state.status === "free") {
    await tx.delete(documentLoroIsolation).where(isolationScope(scope)).run();
    return;
  }
  const values = {
    documentId: state.documentId,
    suspects: JSON.stringify(state.suspects),
  };
  await tx
    .insert(documentLoroIsolation)
    .values({ ...values, appKind: scope.appKind, localId: scope.localId })
    .onConflictDoUpdate({
      set: values,
      target: [documentLoroIsolation.appKind, documentLoroIsolation.localId],
    })
    .run();
}

/** Drops the windows and isolation of deleted or rebound scopes. */
export async function deleteDocumentLoroWindowsInTransaction(
  tx: Pick<ClientSQLiteTransactionScope, "delete">,
  appKind: string,
  localIds: readonly string[],
): Promise<void> {
  for (
    let offset = 0;
    offset < localIds.length;
    offset += LOCAL_IDS_PER_STATEMENT
  ) {
    const batch = localIds.slice(offset, offset + LOCAL_IDS_PER_STATEMENT);
    await tx
      .delete(documentLoroWindows)
      .where(
        and(
          eq(documentLoroWindows.appKind, appKind),
          inArray(documentLoroWindows.localId, batch),
        ),
      )
      .run();
    await tx
      .delete(documentLoroIsolation)
      .where(
        and(
          eq(documentLoroIsolation.appKind, appKind),
          inArray(documentLoroIsolation.localId, batch),
        ),
      )
      .run();
  }
}
