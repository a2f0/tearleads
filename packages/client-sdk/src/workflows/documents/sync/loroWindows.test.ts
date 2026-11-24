import { afterEach, beforeEach, expect, test } from "bun:test";
import { createDocument } from "@tearleads/loro";
import type { DocumentSyncResponse } from "@tearleads/validators/response";
import {
  createLoroWindowBench,
  DOCUMENT_ID,
  device,
  EMPTY_RESPONSE,
  FIRST,
  honest,
  MAIN,
  SCOPE,
  SECOND,
} from "../../../../test/helpers/workflows/loroWindowBench";
import type { DecryptedDocumentSyncUpdate } from "../../../data/documents/shared/sync/documentSyncTypes";
import { documentVerdictJudge } from "../../../data/documents/shared/sync/documentUpdateVerdict";
import { createLoroLifetimes } from "../../../data/documents/shared/sync/loroLifetime";
import {
  LoroRuntimeFailureLedger,
  MAX_LORO_RUNTIME_ATTEMPTS,
} from "../../../data/documents/shared/sync/loroRuntimeFailureLedger";
import {
  readRecordedImportVoids,
  recordDocumentSyncVerdictsInTransaction,
} from "../../../data/persistence/documents/records/documentSyncVerdictPersistence";
import { getClientSQLitePersistenceRuntime } from "../../../data/sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import {
  closeDocumentSyncLoroWindowInTransaction,
  createDocumentSyncLoroWindow,
} from "./loroPassWindow";
import { claimDocumentSyncOrphanWindows } from "./loroWindows";
import { judgeDocumentSyncImports } from "./processedCursor";

const bench = createLoroWindowBench();
const { judgeIn, pageLimit, recordedAttempts } = bench;
let execSql: ExecSql;

beforeEach(async () => {
  execSql = await bench.open();
});

afterEach(() => bench.close());

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
  await commitPage([FIRST], { hasMore: true });
  expect(await pageLimit()).toBe(1);
  await commitPage([SECOND], { hasMore: true });
  expect(await pageLimit()).toBeUndefined();
});

/** Saves a page that accepted `ids`, closing its window. */
function commitPage(
  ids: readonly string[],
  outcome: { readonly hasMore: boolean; readonly held?: readonly string[] },
) {
  const held = outcome.held ?? [];
  return closeDocumentSyncLoroWindowInTransaction(execSql, {
    documentId: DOCUMENT_ID,
    scope: SCOPE,
    synced: {
      decryptedUpdates: ids.map((id) => ({
        id,
      })) as unknown as DecryptedDocumentSyncUpdate[],
      hasHeldPull: held.length > 0,
      hasIncompletePull: outcome.hasMore,
      response: {
        pullPage: { hasMore: outcome.hasMore },
        updates: [...ids, ...held].map((id) => ({ id })),
      } as unknown as DocumentSyncResponse,
      voidedUpdates: [],
    },
    window: null,
  });
}

// A page that held a suspect behind a runtime failure is handed on as if
// the pull were complete; it did not pass the suspect, so isolation stays.
test("a page that holds a suspect keeps isolating it", async () => {
  const host = device();
  const first = await honest(FIRST);
  const second = await honest(SECOND);
  await judgeIn(host.lifetime("dead"), [first.update, second.update]);
  host.kill("dead");
  await judgeIn(host.lifetime("next"), [first.update]);

  await commitPage([], { hasMore: false, held: [FIRST] });
  expect(await pageLimit()).toBe(1);
  await commitPage([SECOND], { hasMore: true });

  expect(await pageLimit()).toBe(1);
});

// Another tab may settle the update between the death and the claim: its
// verdict stands, and the death adds no attempt over it.
test("a death toward an update another tab voided leaves that void", async () => {
  const host = device();
  const { update } = await honest(FIRST);
  await judgeIn(host.lifetime("dead"), [update]);
  host.kill("dead");
  await recordDocumentSyncVerdictsInTransaction(
    getClientSQLitePersistenceRuntime(execSql).db,
    {
      acceptedUpdateIds: [],
      documentId: DOCUMENT_ID,
      judge: documentVerdictJudge(),
      now: "2026-11-23T00:00:00.000Z",
      scope: SCOPE,
      voids: [
        {
          attempts: null,
          message: "voided elsewhere",
          stage: "loro_import",
          updateId: FIRST,
        },
      ],
    },
  );

  await claimDocumentSyncOrphanWindows({
    ...MAIN,
    execSql,
    lifetimes: host.lifetime("next"),
  });

  const [row] = await readRecordedImportVoids(
    getClientSQLitePersistenceRuntime(execSql).db,
    { judge: documentVerdictJudge(), scope: SCOPE, updateIds: [FIRST] },
  );
  expect(row?.stage).toBe("loro_import");
});

// Without storage or page visibility a close cannot be told from a death,
// so such a lifetime's window isolates its update instead of counting it.
test("a lifetime that cannot keep markers counts no death", async () => {
  const host = device();
  const { update } = await honest(FIRST);
  await judgeIn(host.unmarkedLifetime("unmarked"), [update]);
  host.kill("unmarked");

  await claimDocumentSyncOrphanWindows({
    ...MAIN,
    execSql,
    lifetimes: host.lifetime("next"),
  });

  expect(await recordedAttempts(FIRST)).toBeNull();
  expect(await pageLimit()).toBe(1);
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
    dependencyVersionVector: readable.dependencyVersionVector,
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

// Tabs reading one update in a browser process that crashes die together:
// one event, so the claim that finds their windows counts one attempt.
test("tabs dying together on one update count one attempt", async () => {
  const host = device();
  const { update } = await honest(FIRST);
  await judgeIn(host.lifetime("tab-a"), [update]);
  await judgeIn(host.lifetime("tab-b"), [update]);
  host.kill("tab-a");
  host.kill("tab-b");

  await judgeIn(host.lifetime("next"), [update]);

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

// Building the reader's history reads no served update, so a death there
// (a large local document, say) must not be charged to the page's update.
test("a death building the reader's history opens no window", async () => {
  const host = device();
  const { update } = await honest(FIRST);
  const broken = await createDocument("windows-broken");
  broken.free();

  await judgeDocumentSyncImports({
    currentDocument: broken,
    documentId: DOCUMENT_ID,
    execSql,
    lifetimes: host.lifetime("dying"),
    logError: () => undefined,
    loroWindow: createDocumentSyncLoroWindow(),
    result: {
      decryptedUpdates: [update],
      response: EMPTY_RESPONSE,
    },
    runtimeLedger: new LoroRuntimeFailureLedger(),
    scope: SCOPE,
  }).catch(() => undefined);

  expect(
    await execSql("SELECT lifetime_id FROM document_loro_windows"),
  ).toEqual([]);
});
