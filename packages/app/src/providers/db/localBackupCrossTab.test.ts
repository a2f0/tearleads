import { expect, test } from "bun:test";
import {
  type ExecSql,
  ensureLocalSchemaMigrated,
  ensureSqlTables,
  isLocalSchemaMigrationLockTimeoutError,
  type SqlTableSchema,
} from "@tearleads/client-sdk/sqlite";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  readBackupDatabase,
  restoreBackupDatabase,
} from "./localBackupDatabase";

const notesTable: SqlTableSchema = {
  createSql: "CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY)",
  name: "notes",
};

// A FIFO stand-in for the browser's Web Locks (including AbortSignal), which
// Bun lacks.
function installWebLocks(): () => void {
  const queues = new Map<
    string,
    Array<{
      readonly callback: () => Promise<unknown>;
      readonly reject: (reason?: unknown) => void;
      readonly resolve: (value: unknown) => void;
      readonly signal?: AbortSignal | undefined;
    }>
  >();
  const held = new Set<string>();
  const pump = (name: string) => {
    if (held.has(name)) return;
    const queue = queues.get(name);
    while (queue && queue.length > 0) {
      const next = queue.shift();
      if (!next) return;
      if (next.signal?.aborted) {
        next.reject(
          next.signal.reason ?? new DOMException("Aborted", "AbortError"),
        );
        continue;
      }
      held.add(name);
      void Promise.resolve()
        .then(next.callback)
        .then(next.resolve, next.reject)
        .finally(() => {
          held.delete(name);
          pump(name);
        });
      return;
    }
  };
  const locks = {
    request: (
      name: string,
      optionsOrCallback:
        | (() => Promise<unknown>)
        | { readonly signal?: AbortSignal },
      maybeCallback?: () => Promise<unknown>,
    ) => {
      const callback =
        typeof optionsOrCallback === "function"
          ? optionsOrCallback
          : maybeCallback;
      const signal =
        typeof optionsOrCallback === "function"
          ? undefined
          : optionsOrCallback.signal;
      if (!callback) throw new Error("Missing Web Lock callback");
      if (signal?.aborted) {
        return Promise.reject(
          signal.reason ?? new DOMException("Aborted", "AbortError"),
        );
      }
      return new Promise((resolve, reject) => {
        const entry = { callback, reject, resolve, signal };
        const queue = queues.get(name) ?? [];
        queue.push(entry);
        queues.set(name, queue);
        signal?.addEventListener(
          "abort",
          () => {
            const index = queue.indexOf(entry);
            if (index !== -1) {
              queue.splice(index, 1);
              reject(
                signal.reason ?? new DOMException("Aborted", "AbortError"),
              );
            }
          },
          { once: true },
        );
        pump(name);
      });
    },
  };
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: locks,
  });
  return () => {
    Reflect.deleteProperty(navigator, "locks");
  };
}

test("another tab's migration check waits for a restore to commit", async () => {
  const uninstall = installWebLocks();
  const source = await createTestExecSql("backup-cross-tab-source");
  const target = await createTestExecSql("backup-cross-tab-target");
  let resume = () => {};
  try {
    await source.execSql(notesTable.createSql);
    await source.execSql("INSERT INTO notes VALUES ('backup-note')");
    const backup = await readBackupDatabase({ execSql: source.execSql });
    await ensureSqlTables(target.execSql, [notesTable]);

    // Two tabs: separate executors (and mutation queues) on one handle. The
    // restoring tab pauses while it inserts the backup's rows.
    let paused = () => {};
    const pausedInsert = new Promise<void>((resolve) => {
      paused = resolve;
    });
    const resumed = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const restoringTab = (async (sql: string, bind?: never) => {
      if (sql.startsWith('INSERT INTO "notes"')) {
        paused();
        await resumed;
      }
      return target.execSql(sql, bind);
    }) as ExecSql;
    const otherTab = ((sql: string, bind?: never) =>
      target.execSql(sql, bind)) as ExecSql;

    const restoring = restoreBackupDatabase({
      ...backup,
      execSql: restoringTab,
    });
    await pausedInsert;
    const boundedFailure = await ensureLocalSchemaMigrated(
      otherTab,
      async () => {},
      { lockWaitTimeoutMs: 30 },
    ).then(
      () => null,
      (error: unknown) => error,
    );
    expect(isLocalSchemaMigrationLockTimeoutError(boundedFailure)).toBe(true);

    let checked = false;
    const checking = ensureLocalSchemaMigrated(otherTab).then(() => {
      checked = true;
    });
    await Bun.sleep(50);
    expect(checked).toBe(false);

    resume();
    await restoring;
    await checking;
    expect(await target.execSql("SELECT id FROM notes")).toEqual([
      { id: "backup-note" },
    ]);
  } finally {
    resume();
    source.close();
    target.close();
    uninstall();
  }
});
