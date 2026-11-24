import { afterEach, beforeEach, expect, test } from "bun:test";
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
import { writeLoroWindowInTransaction } from "../../../data/persistence/documents/records/loroWindowPersistence";
import { getClientSQLitePersistenceRuntime } from "../../../data/sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { settleDocumentSyncLoroWindow } from "./loroWindows";

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
