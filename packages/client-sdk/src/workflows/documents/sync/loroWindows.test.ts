import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  createDocument,
  exportUpdatesSince,
  getUpdateVersionVectors,
} from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import type { DocumentSyncResponse } from "@tearleads/validators/response";
import type { DecryptedDocumentSyncUpdate } from "../../../data/documents/shared/sync/documentSyncTypes";
import { documentVerdictJudge } from "../../../data/documents/shared/sync/documentUpdateVerdict";
import {
  createLoroLifetimes,
  type LifetimeLockManager,
} from "../../../data/documents/shared/sync/loroLifetime";
import {
  LoroRuntimeFailureLedger,
  MAX_LORO_RUNTIME_ATTEMPTS,
} from "../../../data/documents/shared/sync/loroRuntimeFailureLedger";
import { ensureDocumentTables } from "../../../data/persistence/documents/records";
import { readRecordedImportVoids } from "../../../data/persistence/documents/records/documentSyncVerdictPersistence";
import { getClientSQLitePersistenceRuntime } from "../../../data/sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import {
  claimDocumentSyncOrphanWindows,
  closeDocumentSyncLoroWindowInTransaction,
  readDocumentSyncPageLimit,
  settleDocumentSyncLoroWindow,
} from "./loroWindows";
import { judgeDocumentSyncImports } from "./processedCursor";

const SCOPE = { appKind: "documents", localId: "windows" } as const;
const DOCUMENT_ID = "550e8400-e29b-41d4-a716-446655440e00";
const FIRST = "550e8400-e29b-41d4-a716-446655440e01";
const SECOND = "550e8400-e29b-41d4-a716-446655440e02";
const EMPTY_RESPONSE = { updates: [] } as unknown as DocumentSyncResponse;
const MAIN = { documentId: DOCUMENT_ID, scope: SCOPE };
const OTHER = {
  documentId: "550e8400-e29b-41d4-a716-446655440f00",
  scope: { appKind: "documents", localId: "windows-other" },
} as const;
type Target = typeof MAIN | typeof OTHER;

let close: () => void = () => undefined;
let execSql: ExecSql;

beforeEach(async () => {
  const database = await createTestExecSql(`windows-${crypto.randomUUID()}`);
  close = database.close;
  execSql = database.execSql;
  await ensureDocumentTables(execSql);
  for (const { documentId, scope } of [MAIN, OTHER]) {
    await execSql(
      `INSERT INTO documents (app_kind, local_id, document_id,
         snapshot_end_version, updated_at)
       VALUES (?, ?, ?, '', '2026-11-23T00:00:00.000Z')`,
      [scope.appKind, scope.localId, documentId],
    );
  }
});

afterEach(() => close());

/** Browser surfaces for several lifetimes of one device. */
function device() {
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
async function honest(id: string) {
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

/**
 * One lifetime judging a page. Its save never runs, so its window stays as
 * a process that died after reading would leave it.
 */
async function judgeIn(
  lifetimes: ReturnType<ReturnType<typeof device>["lifetime"]>,
  updates: readonly DecryptedDocumentSyncUpdate[],
  ledger = new LoroRuntimeFailureLedger(),
  target: Target = MAIN,
) {
  const currentDocument = await createDocument("windows-reader");
  try {
    return await judgeDocumentSyncImports({
      currentDocument,
      documentId: target.documentId,
      execSql,
      lifetimes,
      logError: () => undefined,
      opensLoroWindow: true,
      result: {
        contentKeyFingerprintsByEpoch: new Map(),
        decryptedUpdates: [...updates],
        response: EMPTY_RESPONSE,
      },
      runtimeLedger: ledger,
      scope: target.scope,
    });
  } finally {
    currentDocument.free();
  }
}

async function recordedAttempts(updateId: string, target: Target = MAIN) {
  const [row] = await readRecordedImportVoids(
    getClientSQLitePersistenceRuntime(execSql).db,
    {
      judge: documentVerdictJudge(),
      scope: target.scope,
      updateIds: [updateId],
    },
  );
  return row?.stage === "loro_runtime" ? row.attempts : null;
}

function pageLimit(target: Target = MAIN) {
  return readDocumentSyncPageLimit(execSql, target);
}

function claimIn(
  lifetimes: ReturnType<ReturnType<typeof device>["lifetime"]>,
  target: Target,
) {
  return claimDocumentSyncOrphanWindows({ ...target, execSql, lifetimes });
}

// A payload that kills the process records no attempt from inside it; its
// window does, once the next lifetime finds it. Without that the device
// dies on the update in every lifetime.
test("each death reading one update counts, until the update is a final void", async () => {
  const host = device();
  const { reads, update } = await honest(FIRST);
  for (let lifetime = 1; lifetime <= MAX_LORO_RUNTIME_ATTEMPTS; lifetime += 1) {
    await judgeIn(host.lifetime(`dead-${lifetime}`), [update]);
    host.kill(`dead-${lifetime}`);
  }
  const readsBefore = reads.count;

  const verdicts = await judgeIn(host.lifetime("survivor"), [update]);

  expect(await recordedAttempts(FIRST)).toBe(MAX_LORO_RUNTIME_ATTEMPTS);
  expect(reads.count).toBe(readsBefore);
  expect(verdicts.voided.map((voided) => voided.updateId)).toEqual([FIRST]);
});

// The user ended that lifetime by hiding or closing the app, which says
// nothing about the update it was reading.
test("a death after the app was hidden counts nothing and isolates nothing", async () => {
  const host = device();
  const { update } = await honest(FIRST);
  await judgeIn(host.lifetime("hidden"), [update]);
  host.hide();
  host.kill("hidden");
  expect(host.markers.size).toBe(1);

  await judgeIn(host.lifetime("next"), [update]);

  expect(await recordedAttempts(FIRST)).toBeNull();
  expect(await pageLimit()).toBeUndefined();
  expect(host.markers.has("tearleads-loro-hidden:hidden")).toBe(false);
});

// A death with several updates open says nothing about any one of them, so
// none is counted; each is read alone until the device has passed them.
test("a death in a window of several updates isolates them", async () => {
  const host = device();
  const first = await honest(FIRST);
  const second = await honest(SECOND);
  await judgeIn(host.lifetime("dead"), [first.update, second.update]);
  host.kill("dead");

  await judgeIn(host.lifetime("next"), [first.update]);

  expect(await recordedAttempts(FIRST)).toBeNull();
  expect(await recordedAttempts(SECOND)).toBeNull();
  expect(await pageLimit()).toBe(1);
  const page = (ids: string[], hasMore: boolean) =>
    closeDocumentSyncLoroWindowInTransaction(execSql, {
      documentId: DOCUMENT_ID,
      scope: SCOPE,
      synced: {
        response: {
          pullPage: { hasMore },
          updates: ids.map((id) => ({ id })),
        } as unknown as DocumentSyncResponse,
      },
    });
  await page([FIRST], true);
  expect(await pageLimit()).toBe(1);
  await page([SECOND], true);
  expect(await pageLimit()).toBeUndefined();
});

test("a live lifetime's window is never claimed", async () => {
  const host = device();
  const { update } = await honest(FIRST);
  await judgeIn(host.lifetime("live"), [update]);

  await judgeIn(host.lifetime("other-tab"), [update]);

  expect(await recordedAttempts(FIRST)).toBeNull();
  expect(await pageLimit()).toBeUndefined();
});

// Each lifetime counts at most one failure: a lifetime that already failed
// cannot spend an attempt by dying, so its death isolates instead.
test("a lifetime that already failed isolates its death instead of counting it", async () => {
  const host = device();
  const { update } = await honest(FIRST);
  const failed = new LoroRuntimeFailureLedger();
  failed.noteUnattributedFailure();
  await judgeIn(host.lifetime("failed"), [update], failed);
  host.kill("failed");

  await judgeIn(host.lifetime("next"), [update]);

  expect(await recordedAttempts(FIRST)).toBeNull();
  expect(await pageLimit()).toBe(1);
});

// A trap counted in a lifetime stops its windows counting in the same
// transaction, so a death later in that lifetime is not a second attempt.
test("a trap stops its lifetime's window counting", async () => {
  const host = device();
  const { update: readable } = await honest(FIRST);
  const trapping: DecryptedDocumentSyncUpdate = {
    id: readable.id,
    partialEndVersionVector: readable.partialEndVersionVector,
    partialStartVersionVector: readable.partialStartVersionVector,
    get updateData(): Uint8Array {
      throw new WebAssembly.RuntimeError("unreachable");
    },
  };
  await judgeIn(host.lifetime("trapped"), [trapping]);
  expect(await recordedAttempts(FIRST)).toBe(1);
  host.kill("trapped");

  await judgeIn(host.lifetime("next"), [readable]);

  expect(await recordedAttempts(FIRST)).toBe(1);
  expect(await pageLimit()).toBe(1);
});

// A trap in container metadata, rotation, or a founding view marks the
// lifetime as failed too. A window the document page held open then counts
// nothing: the death may be the module's state, not the update.
test("a failure elsewhere in the lifetime stops its open window counting", async () => {
  const host = device();
  const { update } = await honest(FIRST);
  const lifetime = host.lifetime("failed-elsewhere");
  const ledger = new LoroRuntimeFailureLedger(Date.now, () =>
    lifetime.noteFailed(),
  );
  await judgeIn(lifetime, [update], ledger);
  ledger.noteUnattributedFailure();
  host.kill("failed-elsewhere");

  await judgeIn(host.lifetime("next"), [update]);

  expect(await recordedAttempts(FIRST)).toBeNull();
  expect(await pageLimit()).toBe(1);
});

// Tabs share one database: two live tabs that both list an orphan before
// either claims it must still count its death once.
test("two tabs claiming one orphan count its death once", async () => {
  const host = device();
  const { update } = await honest(FIRST);
  await judgeIn(host.lifetime("dead"), [update]);
  host.kill("dead");
  const tabs = [host.lifetime("tab-a"), host.lifetime("tab-b")];
  await Promise.all(tabs.map((tab) => tab.ready()));

  await Promise.all(
    tabs.map((lifetimes) =>
      claimDocumentSyncOrphanWindows({
        documentId: DOCUMENT_ID,
        execSql,
        lifetimes,
        scope: SCOPE,
      }),
    ),
  );

  expect(await recordedAttempts(FIRST)).toBe(1);
});

// A refused lock must not stop sync: the page is judged without a window.
test("a lifetime whose lock is refused judges without a window", async () => {
  const { update } = await honest(FIRST);
  const refused = createLoroLifetimes({
    id: "refused",
    locks: {
      query: async () => ({ held: [] }),
      request: async () => {
        throw new Error("SecurityError");
      },
    },
  });

  const verdicts = await judgeIn(refused, [update]);

  expect(verdicts.voided).toEqual([]);
  expect(
    await execSql("SELECT lifetime_id FROM document_loro_windows"),
  ).toEqual([]);
});

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

// A generation invalidated once the claim commits keeps its count but, like
// its verdicts, reports nothing.
test("a claim whose generation ends after commit reports nothing", async () => {
  const host = device();
  const { update } = await honest(FIRST);
  await judgeIn(host.lifetime("dead"), [update]);
  host.kill("dead");
  const reports: unknown[] = [];
  let guards = 0;

  await claimDocumentSyncOrphanWindows({
    ...MAIN,
    execSql,
    isCurrent: () => {
      guards += 1;
      return guards === 1;
    },
    lifetimes: host.lifetime("next"),
    logError: (message) => reports.push(message),
  });

  expect(await recordedAttempts(FIRST)).toBe(1);
  expect(reports).toEqual([]);
});
