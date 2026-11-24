import { afterEach, beforeEach, expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  createLoroWindowBench,
  device,
  FIRST,
  honest,
  MAIN,
  SECOND,
} from "../../../../test/helpers/workflows/loroWindowBench";
import { documentVerdictJudge } from "../../../data/documents/shared/sync/documentUpdateVerdict";
import { ensureDocumentTables } from "../../../data/persistence/documents/records";
import { readRecordedImportVoids } from "../../../data/persistence/documents/records/documentSyncVerdictPersistence";
import { getClientSQLitePersistenceRuntime } from "../../../data/sqlite/sqlitePersistenceRuntime";
import { createExecSql, type ExecSql } from "../../../data/sqlite/sqlSchema";
import {
  createDocumentSyncLoroWindow,
  settleDocumentSyncLoroWindow,
} from "./loroPassWindow";
import {
  claimDocumentSyncOrphanWindows,
  readDocumentSyncPageLimit,
} from "./loroWindows";

const bench = createLoroWindowBench();
const { claimIn, judgeIn, pageLimit, recordedAttempts } = bench;
let execSql: ExecSql;

beforeEach(async () => {
  execSql = await bench.open();
});

afterEach(() => bench.close());

/** The bench database, whose window deletes fail once `failing` is set. */
function failingDeletes() {
  const flaky = {
    execSql: createExecSql({
      exec: async ({ bind, rowMode, sql }) => {
        if (flaky.failing && /delete from "document_loro_windows"/i.test(sql)) {
          throw new Error("disk I/O error");
        }
        return {
          rows: await execSql(sql, bind, { rowMode: rowMode ?? "object" }),
        };
      },
    }),
    failing: false,
  };
  return flaky;
}

// A store whose runtime moved to another database settles with the new one;
// the window's row must still go from the database it was written to.
test("a settle deletes the window from the database it was opened in", async () => {
  const host = device();
  const { update } = await honest(FIRST);
  const lifetime = host.lifetime("moved");
  const pass = createDocumentSyncLoroWindow();
  const moved = await createTestExecSql(`windows-moved-${crypto.randomUUID()}`);
  try {
    await ensureDocumentTables(moved.execSql);
    await judgeIn(lifetime, [update], undefined, MAIN, { window: pass });

    // The save committed to the store's new database, not the window's.
    await settleDocumentSyncLoroWindow(pass, moved.execSql);

    expect(
      await execSql("SELECT lifetime_id FROM document_loro_windows"),
    ).toEqual([]);
  } finally {
    moved.close();
  }
});

// A row that cannot be deleted outlives its window; the lifetime's failure
// marker then stands, so its death isolates that row instead of counting it.
test("a window whose row cannot be deleted no longer counts its death", async () => {
  const host = device();
  const { update } = await honest(FIRST);
  const lifetime = host.lifetime("stuck");
  const flaky = failingDeletes();
  const pass = createDocumentSyncLoroWindow();
  await judgeIn(lifetime, [update], undefined, MAIN, {
    execSql: flaky.execSql,
    window: pass,
  });
  flaky.failing = true;

  await settleDocumentSyncLoroWindow(pass, null);
  host.kill("stuck");
  await claimIn(host.lifetime("next"), MAIN);

  expect(pass.held).toBeNull();
  expect(lifetime.openWindowCount()).toBe(0);
  expect(await recordedAttempts(FIRST)).toBeNull();
  expect(await pageLimit(MAIN)).toBe(1);
});

// The database worker does not isolate one tab's transaction from another
// tab's statements, so another tab may claim an orphan between this claim's
// read and its delete. Only the claim whose delete removed the row settles it.
test("an orphan another tab claims mid-claim is not counted again", async () => {
  const host = device();
  const { update } = await honest(FIRST);
  await judgeIn(host.lifetime("dead"), [update]);
  host.kill("dead");
  let claimedElsewhere = false;
  const racing = createExecSql({
    exec: async ({ bind, rowMode, sql }) => {
      if (
        !claimedElsewhere &&
        /delete from "document_loro_windows"/i.test(sql)
      ) {
        claimedElsewhere = true;
        await execSql("DELETE FROM document_loro_windows");
      }
      return {
        rows: await execSql(sql, bind, { rowMode: rowMode ?? "object" }),
      };
    },
  });

  await claimDocumentSyncOrphanWindows({
    ...MAIN,
    execSql: racing,
    lifetimes: host.lifetime("next"),
  });

  expect(claimedElsewhere).toBe(true);
  expect(await recordedAttempts(FIRST)).toBeNull();
});

/** A second database, as the store's runtime moves to mid-pass. */
async function movedDatabase() {
  const moved = await createTestExecSql(`windows-moved-${crypto.randomUUID()}`);
  await ensureDocumentTables(moved.execSql);
  return moved;
}

// When the store's runtime moves mid-pass, a new pass reads the scope while
// the stale one still runs. Each settles only its own window: the stale
// pass's row leaves its database, and the markers still cover the new pass.
test("a stale pass settles only its own window", async () => {
  const host = device();
  const { update: first } = await honest(FIRST);
  const { update: second } = await honest(SECOND);
  const lifetime = host.lifetime("swapped");
  const stale = createDocumentSyncLoroWindow();
  const moved = await movedDatabase();
  try {
    await judgeIn(lifetime, [first], undefined, MAIN, { window: stale });
    await judgeIn(lifetime, [second], undefined, MAIN, {
      execSql: moved.execSql,
    });

    await settleDocumentSyncLoroWindow(stale, null);
    host.hide();
    host.kill("swapped");
    await claimIn(host.lifetime("next"), MAIN);

    expect(lifetime.openWindowCount()).toBe(1);
    expect(lifetime.endedHidden("swapped")).toBe(true);
    expect(
      await moved.execSql("SELECT lifetime_id FROM document_loro_windows"),
    ).toEqual([{ lifetime_id: "swapped" }]);
    expect(await recordedAttempts(FIRST)).toBeNull();
    expect(await pageLimit(MAIN)).toBeUndefined();
  } finally {
    moved.close();
  }
});

// A window in one database must stop counting once the lifetime reads in
// another: a death then could be either page's.
test("a window opened in another database stops the first counting", async () => {
  const host = device();
  const { update: first } = await honest(FIRST);
  const { update: second } = await honest(SECOND);
  const lifetime = host.lifetime("two-databases");
  const moved = await movedDatabase();
  try {
    await judgeIn(lifetime, [first]);
    await judgeIn(lifetime, [second], undefined, MAIN, {
      execSql: moved.execSql,
    });
    host.kill("two-databases");
    await claimIn(host.lifetime("next"), MAIN);

    expect(await recordedAttempts(FIRST)).toBeNull();
    expect(await pageLimit(MAIN)).toBe(1);
  } finally {
    moved.close();
  }
});

// A lifetime that could not settle a window may hold windows in databases a
// claim cannot see: claiming its stuck row in one keeps its markers, so its
// lone window in another still does not count a death the user's close was.
test("an unsettled lifetime's markers outlast a claim in one database", async () => {
  const host = device();
  const { update: first } = await honest(FIRST);
  const { update: second } = await honest(SECOND);
  const lifetime = host.lifetime("unsettled");
  const flaky = failingDeletes();
  const stuck = createDocumentSyncLoroWindow();
  await judgeIn(lifetime, [first], undefined, MAIN, {
    execSql: flaky.execSql,
    window: stuck,
  });
  flaky.failing = true;
  await settleDocumentSyncLoroWindow(stuck, null);
  const moved = await movedDatabase();
  try {
    await judgeIn(lifetime, [second], undefined, MAIN, {
      execSql: moved.execSql,
    });
    host.hide();
    host.kill("unsettled");
    await claimIn(host.lifetime("next"), MAIN);
    await claimDocumentSyncOrphanWindows({
      ...MAIN,
      execSql: moved.execSql,
      lifetimes: host.lifetime("next"),
    });

    expect(await recordedAttempts(FIRST)).toBeNull();
    expect(
      await readRecordedImportVoids(
        getClientSQLitePersistenceRuntime(moved.execSql).db,
        {
          judge: documentVerdictJudge(),
          scope: MAIN.scope,
          updateIds: [SECOND],
        },
      ),
    ).toEqual([]);
    expect(
      await readDocumentSyncPageLimit(moved.execSql, MAIN),
    ).toBeUndefined();
  } finally {
    moved.close();
  }
});

// Another tab's claim may forget a dead lifetime's markers once its own rows
// are gone, while this claim is between listing an orphan and deleting it;
// the markers this claim judges by are read before any delete.
test("a claim judges by the markers it saw before deleting", async () => {
  const host = device();
  const { update } = await honest(FIRST);
  await judgeIn(host.lifetime("hidden"), [update]);
  host.hide();
  host.kill("hidden");
  let forgotten = false;
  const racing = createExecSql({
    exec: async ({ bind, rowMode, sql }) => {
      if (!forgotten && /delete from "document_loro_windows"/i.test(sql)) {
        forgotten = true;
        host.markers.clear();
      }
      return {
        rows: await execSql(sql, bind, { rowMode: rowMode ?? "object" }),
      };
    },
  });

  await claimDocumentSyncOrphanWindows({
    ...MAIN,
    execSql: racing,
    lifetimes: host.lifetime("next"),
  });

  expect(forgotten).toBe(true);
  expect(await recordedAttempts(FIRST)).toBeNull();
  expect(await pageLimit(MAIN)).toBeUndefined();
});
