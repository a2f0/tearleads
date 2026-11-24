import { afterEach, beforeEach, expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  createLoroWindowBench,
  DOCUMENT_ID,
  device,
  FIRST,
  honest,
  MAIN,
  OTHER,
  SCOPE,
  SECOND,
} from "../../../../test/helpers/workflows/loroWindowBench";
import { documentVerdictJudge } from "../../../data/documents/shared/sync/documentUpdateVerdict";
import { ensureDocumentTables } from "../../../data/persistence/documents/records";
import { writeLoroWindowInTransaction } from "../../../data/persistence/documents/records/loroWindowPersistence";
import { getClientSQLitePersistenceRuntime } from "../../../data/sqlite/sqlitePersistenceRuntime";
import { createExecSql, type ExecSql } from "../../../data/sqlite/sqlSchema";
import {
  claimDocumentSyncOrphanWindows,
  settleDocumentSyncLoroWindow,
} from "./loroWindows";

const bench = createLoroWindowBench();
const { claimIn, judgeIn, pageLimit, recordedAttempts } = bench;
let execSql: ExecSql;

beforeEach(async () => {
  execSql = await bench.open();
});

afterEach(() => bench.close());

// Document lanes read in parallel. A death with two scopes' windows open
// says nothing about either update, so both are isolated, neither counted.
test("a death with two scopes' windows open counts toward neither", async () => {
  const host = device();
  const { update: first } = await honest(FIRST);
  const { update: second } = await honest(SECOND);
  const dead = host.lifetime("dead");
  await judgeIn(dead, [first]);
  await judgeIn(dead, [second], undefined, OTHER);
  host.kill("dead");

  const next = host.lifetime("next");
  await claimIn(next, MAIN);
  await claimIn(next, OTHER);

  expect(await recordedAttempts(FIRST)).toBeNull();
  expect(await recordedAttempts(SECOND, OTHER)).toBeNull();
  expect(await pageLimit(MAIN)).toBe(1);
  expect(await pageLimit(OTHER)).toBe(1);
});

// A hidden lifetime's marker must outlast the claim of its first window:
// its window on another scope says nothing either.
test("a hidden death leaves every scope it read alone", async () => {
  const host = device();
  const { update: first } = await honest(FIRST);
  const { update: second } = await honest(SECOND);
  const hidden = host.lifetime("hidden");
  await judgeIn(hidden, [first]);
  await judgeIn(hidden, [second], undefined, OTHER);
  host.hide();
  host.kill("hidden");

  const next = host.lifetime("next");
  await claimIn(next, MAIN);
  await claimIn(next, OTHER);

  expect(await pageLimit(MAIN)).toBeUndefined();
  expect(await pageLimit(OTHER)).toBeUndefined();
  expect(host.markers.size).toBe(0);
});

// An isolating scope waits until it is the lifetime's only window, so a
// killer read there is counted even while other lanes keep reading.
test("an isolating scope reads alone, so a killer there counts", async () => {
  const host = device();
  const { update: first } = await honest(FIRST);
  const { update: second } = await honest(SECOND);
  const lifetime = host.lifetime("isolating");
  await judgeIn(lifetime, [second], undefined, OTHER);
  await execSql(
    `INSERT INTO document_loro_isolation
       (app_kind, local_id, document_id, suspects)
     VALUES (?, ?, ?, ?)`,
    [SCOPE.appKind, SCOPE.localId, DOCUMENT_ID, JSON.stringify([FIRST])],
  );
  let judged = false;
  const judging = judgeIn(lifetime, [first]).then(() => {
    judged = true;
  });
  await Bun.sleep(20);
  expect(judged).toBe(false);

  await settleDocumentSyncLoroWindow({
    committed: false,
    execSql,
    lifetimes: lifetime,
    scope: OTHER.scope,
  });
  await judging;
  host.kill("isolating");
  await claimIn(host.lifetime("next"), MAIN);

  expect(await recordedAttempts(FIRST)).toBe(1);
});

// A settle whose delete failed leaves its counting row behind. The lifetime's
// next window, even one alone, stops it counting, so a later death is not
// charged to the page that row names.
test("a row a failed settle left stops counting when the lifetime reads again", async () => {
  const host = device();
  const { update } = await honest(FIRST);
  const lifetime = host.lifetime("stale");
  await writeLoroWindowInTransaction(
    getClientSQLitePersistenceRuntime(execSql).db,
    OTHER.scope,
    {
      contentKeyEpoch: null,
      counts: true,
      documentId: OTHER.documentId,
      judge: documentVerdictJudge(),
      keyFingerprint: null,
      lifetimeId: "stale",
      updateIds: [SECOND],
    },
    "2026-11-23T00:00:00.000Z",
  );

  await judgeIn(lifetime, [update]);
  host.kill("stale");
  await claimIn(host.lifetime("next"), OTHER);

  expect(await recordedAttempts(SECOND, OTHER)).toBeNull();
});

// The page is read with Loro even when its pass has gone stale, so its window
// is written regardless: otherwise another document's lone window would stay
// counting while this page's reads ran beside it.
test("a page read under a stale generation still stops other windows counting", async () => {
  const host = device();
  const { update: first } = await honest(FIRST);
  const { update: second } = await honest(SECOND);
  const lifetime = host.lifetime("stale-pass");
  await judgeIn(lifetime, [first]);
  await judgeIn(lifetime, [second], undefined, OTHER, {
    isCurrent: () => false,
  });
  host.kill("stale-pass");

  const next = host.lifetime("next");
  await claimIn(next, MAIN);
  await claimIn(next, OTHER);

  expect(await recordedAttempts(FIRST)).toBeNull();
  expect(await pageLimit(MAIN)).toBe(1);
  expect(await pageLimit(OTHER)).toBe(1);
});

// A store whose runtime moved to another database settles with the new one;
// the window's row must still go from the database it was written to.
test("a settle deletes the window from the database it was opened in", async () => {
  const host = device();
  const { update } = await honest(FIRST);
  const lifetime = host.lifetime("moved");
  const moved = await createTestExecSql(`windows-moved-${crypto.randomUUID()}`);
  try {
    await ensureDocumentTables(moved.execSql);
    await judgeIn(lifetime, [update]);

    await settleDocumentSyncLoroWindow({
      committed: false,
      execSql: moved.execSql,
      lifetimes: lifetime,
      scope: SCOPE,
    });

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
  let failDeletes = false;
  const flaky = createExecSql({
    exec: async ({ bind, rowMode, sql }) => {
      if (failDeletes && /delete from "document_loro_windows"/i.test(sql)) {
        throw new Error("disk I/O error");
      }
      return {
        rows: await execSql(sql, bind, { rowMode: rowMode ?? "object" }),
      };
    },
  });
  await judgeIn(lifetime, [update], undefined, MAIN, { execSql: flaky });
  failDeletes = true;

  await settleDocumentSyncLoroWindow({
    committed: false,
    execSql: flaky,
    lifetimes: lifetime,
    scope: SCOPE,
  });
  host.kill("stuck");
  await claimIn(host.lifetime("next"), MAIN);

  expect(lifetime.hasWindow(`${SCOPE.appKind}\u0000${SCOPE.localId}`)).toBe(
    false,
  );
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
