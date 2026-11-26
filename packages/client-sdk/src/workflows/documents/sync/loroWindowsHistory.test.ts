import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  createLoroWindowBench,
  device,
  FIRST,
  honest,
  MAIN,
  SECOND,
} from "../../../../test/helpers/workflows/loroWindowBench";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import {
  createDocumentSyncLoroWindow,
  settleDocumentSyncLoroWindow,
} from "./loroPassWindow";

const bench = createLoroWindowBench();
const { judgeIn, pageLimit, recordedAttempts, rotationDeaths, verifyIn } =
  bench;

let execSql: ExecSql;

beforeEach(async () => {
  execSql = await bench.open();
});

afterEach(() => bench.close());

const windowRows = () =>
  execSql("SELECT kind, counts FROM document_loro_windows");

// History verification rebuilds a whole history for a viewer. A death there
// is likeliest the rebuild's size, and a viewer must cost neither an update
// nor the device's rotation (#2970): the window it leaves is discarded.
test("a death verifying history counts nothing and isolates nothing", async () => {
  const host = device();
  const { update } = await honest(FIRST);
  await verifyIn(host.lifetime("dead"), [update]);
  expect(await windowRows()).toEqual([{ counts: 0, kind: "history" }]);
  host.kill("dead");

  await bench.claimIn(host.lifetime("next"), MAIN);

  expect(await windowRows()).toEqual([]);
  expect(await recordedAttempts(FIRST)).toBeNull();
  expect(await pageLimit()).toBeUndefined();
  expect(await rotationDeaths()).toEqual([]);
  expect(await execSql("SELECT update_id FROM document_void_updates")).toEqual(
    [],
  );
});

test("a death verifying a page of several updates leaves no suspects", async () => {
  const host = device();
  const first = await honest(FIRST);
  const second = await honest(SECOND);
  await verifyIn(host.lifetime("dead"), [first.update, second.update]);
  host.kill("dead");

  await bench.claimIn(host.lifetime("next"), MAIN);

  expect(await windowRows()).toEqual([]);
  expect(await pageLimit()).toBeUndefined();
  expect(await rotationDeaths()).toEqual([]);
});

// Verification persists nothing but its window rows, so the window it
// outlives clears no attempt an earlier death counted, as a sync pass's or a
// rotation's would.
test("a history window the process outlives keeps recorded attempts", async () => {
  const host = device();
  const { update } = await honest(FIRST);
  await judgeIn(host.lifetime("dead"), [update]);
  host.kill("dead");
  const survivor = host.lifetime("survivor");
  const window = createDocumentSyncLoroWindow();
  await verifyIn(survivor, [update], window);
  expect(await recordedAttempts(FIRST)).toBe(1);

  await settleDocumentSyncLoroWindow(window, null);

  expect(await windowRows()).toEqual([]);
  expect(await recordedAttempts(FIRST)).toBe(1);
});

// A scope keeps one row a lifetime. A verifier's window opened beside a sync
// pass's must not take that row: a death would then be discarded with the
// history window, and the sync page's updates would never be read alone.
test("a history window leaves a sync pass's row on the scope in place", async () => {
  const host = device();
  const first = await honest(FIRST);
  const second = await honest(SECOND);
  const dead = host.lifetime("dead");
  await judgeIn(dead, [first.update]);
  await verifyIn(dead, [second.update]);
  // Beside another window the sync pass's row counts nothing, but stands.
  expect(await windowRows()).toEqual([{ counts: 0, kind: "read" }]);
  host.kill("dead");

  await bench.claimIn(host.lifetime("next"), MAIN);

  expect(await recordedAttempts(FIRST)).toBeNull();
  expect(await pageLimit()).toBe(1);
  expect(await execSql("SELECT suspects FROM document_loro_isolation")).toEqual(
    [{ suspects: JSON.stringify([FIRST]) }],
  );
});

test("a sync pass's window takes the scope's row from a history window", async () => {
  const host = device();
  const first = await honest(FIRST);
  const second = await honest(SECOND);
  const dead = host.lifetime("dead");
  await verifyIn(dead, [second.update]);
  await judgeIn(dead, [first.update]);
  expect(await windowRows()).toEqual([{ counts: 0, kind: "read" }]);
  host.kill("dead");

  await bench.claimIn(host.lifetime("next"), MAIN);

  expect(await pageLimit()).toBe(1);
});
