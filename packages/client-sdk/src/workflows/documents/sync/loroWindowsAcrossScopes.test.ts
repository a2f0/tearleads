import { afterEach, beforeEach, expect, test } from "bun:test";
import { createDocument } from "@tearleads/loro";
import {
  createLoroWindowBench,
  DOCUMENT_ID,
  device,
  EMPTY_RESPONSE,
  FIRST,
  honest,
  MAIN,
  OTHER,
  SCOPE,
  SECOND,
} from "../../../../test/helpers/workflows/loroWindowBench";
import { validateDocumentSyncUpdateImports } from "../../../data/documents/shared/sync/documentSyncImportVerdicts";
import type { DecryptedDocumentSyncUpdate } from "../../../data/documents/shared/sync/documentSyncTypes";
import { documentVerdictJudge } from "../../../data/documents/shared/sync/documentUpdateVerdict";
import type { LoroLifetimes } from "../../../data/documents/shared/sync/loroLifetime";
import { LoroRuntimeFailureLedger } from "../../../data/documents/shared/sync/loroRuntimeFailureLedger";
import { writeLoroWindowInTransaction } from "../../../data/persistence/documents/records/loroWindowPersistence";
import { getClientSQLitePersistenceRuntime } from "../../../data/sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import {
  createDocumentSyncLoroWindow,
  settleDocumentSyncLoroWindow,
} from "./loroPassWindow";
import { judgeUnrecordedDocumentSyncImports } from "./unrecordedImports";

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
  const otherPass = createDocumentSyncLoroWindow();
  await judgeIn(lifetime, [second], undefined, OTHER, { window: otherPass });
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

  await settleDocumentSyncLoroWindow(otherPass, null);
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
      counts: true,
      documentId: OTHER.documentId,
      judge: documentVerdictJudge(),
      kind: "read",
      lifetimeId: "stale",
      updateIds: [SECOND],
      windowId: "stale-window",
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

// Two passes reading one scope in one database share its row: the later
// replaces it, and the earlier pass's settle leaves the row it no longer
// owns, so a death in the later pass's reads still isolates its update.
test("a pass's settle leaves the row a later pass on the scope wrote", async () => {
  const host = device();
  const { update: first } = await honest(FIRST);
  const { update: second } = await honest(SECOND);
  const lifetime = host.lifetime("two-passes");
  const earlier = createDocumentSyncLoroWindow();
  await judgeIn(lifetime, [first], undefined, MAIN, { window: earlier });
  await judgeIn(lifetime, [second]);

  await settleDocumentSyncLoroWindow(earlier, null);
  host.kill("two-passes");
  await claimIn(host.lifetime("next"), MAIN);

  expect(await recordedAttempts(SECOND)).toBeNull();
  expect(await pageLimit(MAIN)).toBe(1);
});

/**
 * A copy of `update` whose read notes the markers then standing, for a
 * death inside it: `restore` puts them back as the dead process left them.
 */
function readNoting(
  update: Awaited<ReturnType<typeof honest>>["update"],
  markers: Map<string, string>,
) {
  let leftAtDeath = new Map<string, string>();
  return {
    restore() {
      markers.clear();
      for (const [key, value] of leftAtDeath) markers.set(key, value);
    },
    update: {
      id: update.id,
      partialEndVersionVector: update.partialEndVersionVector,
      partialStartVersionVector: update.partialStartVersionVector,
      get updateData(): Uint8Array {
        leftAtDeath = new Map(markers);
        return update.updateData;
      },
    },
  };
}

// Every SDK judge reads in a window, but a host may call the validator
// itself and open none. A death in such a read may be its own, so a lone
// counting window elsewhere must not count it.
test("a death in a read no window covers counts toward no window", async () => {
  const host = device();
  const { update: first } = await honest(FIRST);
  const killer = readNoting((await honest(SECOND)).update, host.markers);
  const lifetime = host.lifetime("unwindowed");
  await judgeIn(lifetime, [first]);
  const reader = await createDocument("unwindowed-reader");
  try {
    await validateDocumentSyncUpdateImports({
      currentDocument: reader,
      decryptedUpdates: [killer.update],
      lifetimes: lifetime,
      runtimeLedger: new LoroRuntimeFailureLedger(),
    });
  } finally {
    reader.free();
  }
  killer.restore();
  host.kill("unwindowed");
  await claimIn(host.lifetime("next"), MAIN);

  expect(await recordedAttempts(FIRST)).toBeNull();
  expect(await pageLimit(MAIN)).toBe(1);
});

// A host call whose every update is a known void reads none with Loro, so
// the lifetime's lone window elsewhere still counts its death.
test("a host validation that reads no update leaves windows counting", async () => {
  const host = device();
  const { update: first } = await honest(FIRST);
  const { update: second } = await honest(SECOND);
  const lifetime = host.lifetime("unread");
  await judgeIn(lifetime, [first]);
  const reader = await createDocument("unread-reader");
  try {
    await validateDocumentSyncUpdateImports({
      currentDocument: reader,
      decryptedUpdates: [second],
      knownVoids: new Map([[SECOND, "loro_import"]]),
      lifetimes: lifetime,
      runtimeLedger: new LoroRuntimeFailureLedger(),
    });
  } finally {
    reader.free();
  }
  host.kill("unread");
  await claimIn(host.lifetime("next"), MAIN);

  expect(await recordedAttempts(FIRST)).toBe(1);
});

/** A rotation's or founding view's read of `update` alone in `lifetimes`. */
async function readUnrecordedIn(
  lifetimes: LoroLifetimes,
  update: DecryptedDocumentSyncUpdate,
  target: typeof OTHER,
): Promise<void> {
  const currentDocument = await createDocument("unrecorded-reader");
  try {
    await judgeUnrecordedDocumentSyncImports({
      currentDocument,
      documentId: target.documentId,
      execSql,
      lifetimes,
      loroWindow: createDocumentSyncLoroWindow(),
      reads: { kind: "read" },
      result: {
        decryptedUpdates: [update],
        response: EMPTY_RESPONSE,
      },
      scope: target.scope,
    });
  } finally {
    currentDocument.free();
  }
}

// A rotation or founding view reads served updates in a window of its own:
// beside a sync window, a death in it says nothing about either update, and
// once it reads an update alone, the death counts toward that update.
test("a death in a rotation or founding read counts only when it reads alone", async () => {
  const host = device();
  const { update: first } = await honest(FIRST);
  const killer = readNoting((await honest(SECOND)).update, host.markers);
  const beside = host.lifetime("beside");
  await judgeIn(beside, [first]);
  await readUnrecordedIn(beside, killer.update, OTHER);
  killer.restore();
  host.kill("beside");
  const next = host.lifetime("next");
  await claimIn(next, MAIN);
  await claimIn(next, OTHER);

  expect(await recordedAttempts(FIRST)).toBeNull();
  expect(await recordedAttempts(SECOND, OTHER)).toBeNull();
  expect(await pageLimit(MAIN)).toBe(1);
  expect(await pageLimit(OTHER)).toBe(1);

  await readUnrecordedIn(next, killer.update, OTHER);
  killer.restore();
  host.kill("next");
  await claimIn(host.lifetime("last"), OTHER);

  expect(await recordedAttempts(SECOND, OTHER)).toBe(1);
});

// A read its own window covers is no stray read: a death inside it counts.
test("a death inside a read its window covers still counts", async () => {
  const host = device();
  const killer = readNoting((await honest(FIRST)).update, host.markers);
  await judgeIn(host.lifetime("windowed"), [killer.update]);
  killer.restore();
  host.kill("windowed");
  await claimIn(host.lifetime("next"), MAIN);

  expect(await recordedAttempts(FIRST)).toBe(1);
});

// Lanes build their readers' histories from accepted data at once, as at
// startup. Like the editor's work, a build leaves an isolating window that
// reads alone counting, or a killer there would never be counted.
test("building a reader's history leaves the lifetime's windows counting", async () => {
  const host = device();
  const { update } = await honest(FIRST);
  const lifetime = host.lifetime("building");
  const isolating = await lifetime.openWindow(true);
  const reader = await createDocument("building-reader");
  const markedWhileBuilding: boolean[] = [];
  const watched = new Proxy(reader, {
    get(target, key) {
      if (key === "export") {
        markedWhileBuilding.push(lifetime.endedFailed("building"));
      }
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  try {
    await validateDocumentSyncUpdateImports({
      beforeUpdateReads: async () => true,
      currentDocument: watched,
      decryptedUpdates: [update],
      lifetimes: lifetime,
      runtimeLedger: new LoroRuntimeFailureLedger(),
    });
  } finally {
    reader.free();
    lifetime.closeWindow(isolating);
  }

  expect(markedWhileBuilding).toEqual([false]);
});

// A lane waiting at the gate runs no Loro work, so it must not keep the
// isolating window it waits behind from counting a killer read alone.
test("a lane waiting at the gate leaves the isolating window counting", async () => {
  const host = device();
  const { update: second } = await honest(SECOND);
  const killer = readNoting((await honest(FIRST)).update, host.markers);
  const lifetime = host.lifetime("queued");
  const reading = createDocumentSyncLoroWindow();
  await judgeIn(lifetime, [second], undefined, OTHER, { window: reading });
  await execSql(
    `INSERT INTO document_loro_isolation
       (app_kind, local_id, document_id, suspects)
     VALUES (?, ?, ?, ?)`,
    [SCOPE.appKind, SCOPE.localId, DOCUMENT_ID, JSON.stringify([FIRST])],
  );
  const isolatingPass = createDocumentSyncLoroWindow();
  const isolating = judgeIn(lifetime, [killer.update], undefined, MAIN, {
    window: isolatingPass,
  });
  await Bun.sleep(20);
  const queued = judgeIn(lifetime, [second], undefined, OTHER);
  await Bun.sleep(20);

  await settleDocumentSyncLoroWindow(reading, null);
  await isolating;
  killer.restore();
  host.kill("queued");
  await claimIn(host.lifetime("next"), MAIN);

  expect(await recordedAttempts(FIRST)).toBe(1);
  await settleDocumentSyncLoroWindow(isolatingPass, null);
  await queued;
});
