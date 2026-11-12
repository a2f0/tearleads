import { expect, test } from "bun:test";
import {
  type ExecSql,
  ensureLocalSchemaMigrated,
  ensureSqlTables,
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

// A FIFO stand-in for the browser's Web Locks, which Bun lacks.
function installWebLocks(): () => void {
  const tails = new Map<string, Promise<void>>();
  const locks = {
    request: async (name: string, callback: () => Promise<unknown>) => {
      const previous = tails.get(name) ?? Promise.resolve();
      let release = () => {};
      const current = new Promise<void>((resolve) => {
        release = resolve;
      });
      tails.set(
        name,
        previous.then(() => current),
      );
      await previous;
      try {
        return await callback();
      } finally {
        release();
      }
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
    let resume = () => {};
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
    source.close();
    target.close();
    uninstall();
  }
});
