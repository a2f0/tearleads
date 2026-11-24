import {
  createDocument,
  exportUpdatesSince,
  getUpdateVersionVectors,
} from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import type { DocumentSyncResponse } from "@tearleads/validators/response";
import type { DecryptedDocumentSyncUpdate } from "../../../src/data/documents/shared/sync/documentSyncTypes";
import { documentVerdictJudge } from "../../../src/data/documents/shared/sync/documentUpdateVerdict";
import {
  createLoroLifetimes,
  type LifetimeLockManager,
  type LoroLifetimes,
} from "../../../src/data/documents/shared/sync/loroLifetime";
import { LoroRuntimeFailureLedger } from "../../../src/data/documents/shared/sync/loroRuntimeFailureLedger";
import { ensureDocumentTables } from "../../../src/data/persistence/documents/records";
import { readRecordedImportVoids } from "../../../src/data/persistence/documents/records/documentSyncVerdictPersistence";
import { getClientSQLitePersistenceRuntime } from "../../../src/data/sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../../src/data/sqlite/sqlSchema";
import {
  createDocumentSyncLoroWindow,
  type DocumentSyncLoroWindow,
} from "../../../src/workflows/documents/sync/loroPassWindow";
import {
  claimDocumentSyncOrphanWindows,
  readDocumentSyncPageLimit,
} from "../../../src/workflows/documents/sync/loroWindows";
import { judgeDocumentSyncImports } from "../../../src/workflows/documents/sync/processedCursor";

/**
 * A device whose Loro lifetimes read sync pages on two documents, for the
 * read-window tests: each lifetime's save never runs, so its windows stay as
 * a process that died after reading would leave them.
 */
export const SCOPE = { appKind: "documents", localId: "windows" } as const;
export const DOCUMENT_ID = "550e8400-e29b-41d4-a716-446655440e00";
export const FIRST = "550e8400-e29b-41d4-a716-446655440e01";
export const SECOND = "550e8400-e29b-41d4-a716-446655440e02";
export const EMPTY_RESPONSE = {
  updates: [],
} as unknown as DocumentSyncResponse;
export const MAIN = { documentId: DOCUMENT_ID, scope: SCOPE };
export const OTHER = {
  documentId: "550e8400-e29b-41d4-a716-446655440f00",
  scope: { appKind: "documents", localId: "windows-other" },
} as const;
type Target = typeof MAIN | typeof OTHER;

/** Browser surfaces for several lifetimes of one device. */
export function device() {
  const held = new Set<string>();
  const markers = new Map<string, string>();
  const listeners: (() => void)[] = [];
  let hidden = false;
  const locks: LifetimeLockManager = {
    query: async () => ({ held: [...held].map((name) => ({ name })) }),
    request: async (name, _options, callback) => {
      held.add(name);
      void callback();
    },
  };
  return {
    hide() {
      hidden = true;
      for (const listener of listeners) listener();
    },
    kill(id: string) {
      held.delete(`tearleads-loro-lifetime:${id}`);
    },
    /** A lifetime of a host with Web Locks but no storage or visibility. */
    unmarkedLifetime: (id: string) => createLoroLifetimes({ id, locks }),
    lifetime: (id: string) =>
      createLoroLifetimes({
        id,
        locks,
        storage: {
          getItem: (key) => markers.get(key) ?? null,
          removeItem: (key) => markers.delete(key),
          setItem: (key, value) => markers.set(key, value),
        },
        visibility: {
          hidden: () => hidden,
          onChange: (listener) => listeners.push(listener),
        },
      }),
    markers,
  };
}

/** An honest update that counts its reads. */
export async function honest(id: string) {
  const source = await createDocument(`windows-${id}`);
  source.getText("text").update(id);
  source.commit();
  const data = exportUpdatesSince(source, undefined);
  source.free();
  const reads = { count: 0 };
  const update: DecryptedDocumentSyncUpdate = {
    id,
    ...getUpdateVersionVectors(data),
    get updateData(): Uint8Array {
      reads.count += 1;
      return data;
    },
  };
  return { reads, update };
}

/** A fresh database with both documents' rows. */
export async function openBenchDatabase() {
  const opened = await createTestExecSql(`windows-${crypto.randomUUID()}`);
  await ensureDocumentTables(opened.execSql);
  for (const { documentId, scope } of [MAIN, OTHER]) {
    await opened.execSql(
      `INSERT INTO documents (app_kind, local_id, document_id,
         snapshot_end_version, updated_at)
       VALUES (?, ?, ?, '', '2026-11-23T00:00:00.000Z')`,
      [scope.appKind, scope.localId, documentId],
    );
  }
  return opened;
}

/** A fresh database per test, with both documents' rows. */
export function createLoroWindowBench() {
  let database: Awaited<ReturnType<typeof openBenchDatabase>> | undefined;
  const current = (): ExecSql => {
    if (!database) throw new Error("Open the bench first");
    return database.execSql;
  };
  return {
    async open(): Promise<ExecSql> {
      database = await openBenchDatabase();
      return database.execSql;
    },
    close() {
      database?.close();
      database = undefined;
    },
    /**
     * One lifetime pulling and judging a page, whose save never runs. Like
     * the store, it claims dead lifetimes' windows before the pull. Each
     * call is a pass of its own unless it names the pass's `window`.
     */
    async judgeIn(
      lifetimes: LoroLifetimes,
      updates: readonly DecryptedDocumentSyncUpdate[],
      ledger = new LoroRuntimeFailureLedger(),
      target: Target = MAIN,
      pass: {
        readonly execSql?: ExecSql;
        readonly isCurrent?: () => boolean;
        readonly window?: DocumentSyncLoroWindow;
      } = {},
    ) {
      await claimDocumentSyncOrphanWindows({
        ...target,
        execSql: pass.execSql ?? current(),
        isCurrent: pass.isCurrent,
        lifetimes,
      });
      const currentDocument = await createDocument("windows-reader");
      try {
        return await judgeDocumentSyncImports({
          currentDocument,
          documentId: target.documentId,
          execSql: pass.execSql ?? current(),
          isCurrent: pass.isCurrent,
          lifetimes,
          logError: () => undefined,
          loroWindow: pass.window ?? createDocumentSyncLoroWindow(),
          result: {
            decryptedUpdates: [...updates],
            response: EMPTY_RESPONSE,
          },
          runtimeLedger: ledger,
          scope: target.scope,
        });
      } finally {
        currentDocument.free();
      }
    },
    async recordedAttempts(updateId: string, target: Target = MAIN) {
      const [row] = await readRecordedImportVoids(
        getClientSQLitePersistenceRuntime(current()).db,
        {
          judge: documentVerdictJudge(),
          scope: target.scope,
          updateIds: [updateId],
        },
      );
      return row?.stage === "loro_runtime" ? row.attempts : null;
    },
    pageLimit(target: Target = MAIN) {
      return readDocumentSyncPageLimit(current(), target);
    },
    claimIn(lifetimes: LoroLifetimes, target: Target) {
      return claimDocumentSyncOrphanWindows({
        ...target,
        execSql: current(),
        lifetimes,
      });
    },
  };
}
